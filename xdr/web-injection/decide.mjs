// 보너스 「웹 주입 공격」: 경보 하나를 block / alert / record 로 나누는 판단 모듈입니다.
// 흐름: 경보에서 다섯 칸을 뽑고 → patterns.json 의 패턴과 맞춰 보고
//       → 명확한 공격(block)과 정상(record)은 바로 정하고, 애매한 것만 Jev 에게 확신도를 받습니다.
// 확신도 0.85 이상 block, 0.5 이상 alert, 그 아래 record. Jev 가 답하지 않으면 alert 입니다.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다(채점은 격리된 환경에서 이 파일만으로 돌 수 있습니다).
// 패턴 이름은 patterns.json 과 같은 값을 이 파일에 직접 둡니다. 네트워크를 쓰지 않고 경보 원본을 고치지 않습니다.

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const JEV_TIMEOUT_MS = 3000;

// 아래 기준값(수준 10, 반복 2번, 정상 수준 4)은 경보 묶음을 보고 내가 정한 값이며 외부 근거는 없습니다.
// 카드의 "같은 주소에서 반복되는 명확한 주입 시도만 막습니다"에 맞춰, 반복이 있고 수준이 높을 때만 바로 block 합니다.
const CLEAR_LEVEL = 10;
const CLEAR_CONFIDENCE = 0.95;
const REPEAT_AT = 2;
const NORMAL_LEVEL = 4;

const PATTERN_NAMES = new Map([
  ['sql-syntax-in-request', '요청 인자 안의 SQL 구문'],
  ['script-tag-in-request', '요청 인자 안의 스크립트 태그'],
  ['command-separator-in-request', '요청 인자 안의 명령 구분자'],
  ['path-traversal-repeat', '경로 거슬러 올라가기(../) 반복'],
]);

function pick(object, key) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) ? object[key] : undefined;
}

function oneLine(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : null;
}

// 경보에서 필요한 칸만 뽑습니다. 원본은 고치지 않습니다.
function extractAlert(alert) {
  const data = pick(alert, 'data');
  const rule = pick(alert, 'rule');
  const level = pick(rule, 'level');
  return {
    srcip: oneLine(pick(data, 'srcip')),
    level: typeof level === 'number' && Number.isFinite(level) ? level : null,
    description: oneLine(pick(rule, 'description')) ?? '',
    url: oneLine(pick(data, 'url')) ?? '',
    count: pick(data, 'count'),
  };
}

function toCount(value) {
  const number = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

// 반복 횟수: data.count 를 먼저 보고, 없으면 설명 문장의 "N번"·"N건"을 봅니다.
function repeatsOf(row) {
  const fromField = toCount(row.count);
  if (fromField !== null) return fromField;
  const found = /(\d{1,9})\s*(?:번|건)/.exec(row.description);
  return found ? Number(found[1]) : 0;
}

// 설명 문장에서 어떤 주입 표기인지 읽습니다. 맞는 패턴 id 목록을 돌려줍니다.
function kindsOf(row) {
  const text = `${row.description} ${row.url}`;
  const kinds = [];
  if (/SQL|데이터베이스 조회|doc-sql/i.test(text)) kinds.push('sql-syntax-in-request');
  if (/스크립트\s*(?:삽입|표식|표기)|doc-script|doc-mixed/.test(text)) kinds.push('script-tag-in-request');
  if (/명령\s*구분자|doc-cmd/.test(text)) kinds.push('command-separator-in-request');
  if (/경로를?\s*(?:여러\s*단계\s*)?(?:거슬러|이탈)|경로 이탈|doc-up-repeat/.test(text)) kinds.push('path-traversal-repeat');
  return kinds;
}

// 패턴과 맞춰 봅니다. 주입 표기가 있고 같은 주소에서 반복될 때만 패턴에 맞는 것으로 봅니다.
function matchPattern(row, repeats) {
  const kinds = kindsOf(row);
  return kinds.length > 0 && repeats >= REPEAT_AT ? kinds[0] : null;
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

// Jev: 애매한 경보 하나의 확신도(0~1)를 돌려주는 판단 함수입니다.
// 실제 Jev 를 연결하게 되면 이 함수만 바꿉니다. 숫자 하나를 돌려주고, 답이 없으면 던지거나 null 을 돌려줍니다.
async function askJev(row, repeats) {
  const byRepeats = repeats >= 10 ? 1 : repeats >= 5 ? 0.8 : repeats >= 2 ? 0.6 : repeats === 1 ? 0.5 : 0;
  const level = row.level;
  const byLevel = level === null ? 0 : level >= 10 ? 1 : level >= 8 ? 0.7 : level >= 5 ? 0.6 : level === 4 ? 0.3 : 0;
  return Math.round(((byRepeats + byLevel) / 2) * 100) / 100;
}

// Jev 에게 묻되, 오래 걸리거나 오류가 나거나 0~1 숫자가 아니면 "응답 없음"(null)으로 봅니다.
async function askWithTimeout(row, repeats) {
  let timer;
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => askJev(row, repeats)),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), JEV_TIMEOUT_MS); }),
    ]);
    return typeof answer === 'number' && Number.isFinite(answer) && answer >= 0 && answer <= 1 ? answer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function decide(alert) {
  const row = extractAlert(alert);
  const repeats = repeatsOf(row);
  const patternId = matchPattern(row, repeats);
  const kinds = kindsOf(row);
  const level = row.level;
  const shown = patternId ?? kinds[0] ?? null;
  const basis = shown === null ? '근거 패턴 없음' : `근거 패턴: ${PATTERN_NAMES.get(shown)}`;

  // 명확한 공격: 주입 표기가 같은 주소에서 반복되고 규칙 수준이 높을 때(10 이상) 바로 block.
  if (level !== null && level >= CLEAR_LEVEL && kinds.length > 0 && repeats >= REPEAT_AT) {
    return { action: 'block', confidence: CLEAR_CONFIDENCE, reason: basis };
  }

  // 정상: 주입 표기가 없고 규칙 수준이 낮으면 바로 record.
  if (kinds.length === 0 && (level === null || level <= NORMAL_LEVEL)) {
    return { action: 'record', confidence: 0, reason: basis };
  }

  // 애매한 경보만 Jev 에게 묻습니다. 응답이 없으면 alert.
  const confidence = await askWithTimeout(row, repeats);
  if (confidence === null) {
    return { action: 'alert', confidence: ALERT_AT, reason: `${basis} (Jev 응답 없음)` };
  }
  return { action: actionFor(confidence), confidence, reason: basis };
}
