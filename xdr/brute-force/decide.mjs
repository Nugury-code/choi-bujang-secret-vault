// 보너스 「무차별 로그인 공격」: 경보 하나를 block / alert / record 로 나누는 판단 모듈입니다.
// 흐름: 경보에서 다섯 칸을 뽑고(read-alerts.mjs) → patterns.json 의 패턴과 맞춰 보고
//       → 명확한 공격(block)과 정상(record)은 바로 정하고, 애매한 것만 Jev 에게 확신도를 받습니다.
// 확신도 0.85 이상 block, 0.5 이상 alert, 그 아래 record. Jev 가 답하지 않으면 alert 입니다.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다. 네트워크를 쓰지 않고 경보 원본을 고치지 않습니다.

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const JEV_TIMEOUT_MS = 3000;

// 명확한 공격의 기준: 규칙 수준이 10 이상(높음)이고, 로그인 실패나 여러 계정 대입의 증거가 함께 있어야 block 합니다.
const CLEAR_LEVEL = 10;
// 규칙 수준과 상관없이 로그인 실패가 3건 이상이거나 계정이 5개 이상이면 block 후보로 크게 늘립니다.
const HEAVY_FAILURES = 3;
const HEAVY_ACCOUNTS = 5;
const CLEAR_CONFIDENCE = 0.95;
// 정상으로 바로 넘기는 기준: 맞는 패턴이 없고 경보 수준이 낮을 때.
const NORMAL_LEVEL = 4;

const PATTERN_IDS = ['same-address-failure-burst', 'same-password-many-accounts'];

// patterns.json 의 이름과 같은 값을 이 파일에 직접 둡니다(다른 파일 없이 혼자 동작하도록).
const PATTERN_NAMES = new Map([
  ['same-address-failure-burst', '짧은 시간 같은 주소의 로그인 실패 연속'],
  ['same-password-many-accounts', '여러 계정에 같은 비밀번호 대입'],
]);

async function loadPatterns() {
  return PATTERN_NAMES;
}

// 경보에서 다섯 칸(시각, 출발 주소, 계정, 규칙 수준, 설명)을 뽑습니다. 원본은 고치지 않습니다.
function pick(object, key) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) ? object[key] : undefined;
}
function text1(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : null;
}
function extractAlert(alert) {
  const data = pick(alert, 'data');
  const rule = pick(alert, 'rule');
  const level = pick(rule, 'level');
  return {
    time: text1(pick(alert, 'timestamp')),
    srcip: text1(pick(data, 'srcip')),
    account: text1(pick(data, 'srcuser')),
    level: typeof level === 'number' && Number.isFinite(level) ? level : null,
    description: text1(pick(rule, 'description')),
  };
}

function toCount(value) {
  const number = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

// 실패 건수와 계정 수. 칸(data.count, data.accounts)을 먼저 보고, 없으면 설명 문장의 숫자를 봅니다.
function evidenceOf(alert, row) {
  const data = alert !== null && typeof alert === 'object' && !Array.isArray(alert) ? alert.data : null;
  const field = data !== null && typeof data === 'object' ? data : {};
  const text = row.description ?? '';

  let failures = toCount(field.count);
  if (failures === null) {
    const found = /(\d{1,9})\s*건/.exec(text);
    failures = found ? Number(found[1]) : 0;
  }

  let accounts = 0;
  if (typeof field.accounts === 'string') {
    accounts = new Set(field.accounts.split(',').map((name) => name.trim()).filter(Boolean)).size;
  } else {
    const found = /계정\s*(\d{1,9})\s*개/.exec(text);
    accounts = found ? Number(found[1]) : 0;
  }
  return { failures, accounts, samePassword: text.includes('같은 비밀번호') };
}

// 패턴과 맞춰 봅니다. 맞는 패턴의 id 를 돌려주고, 없으면 null.
function matchPattern({ failures, accounts, samePassword }) {
  if (accounts >= 5 || (accounts >= 2 && samePassword)) return 'same-password-many-accounts';
  if (failures >= 3) return 'same-address-failure-burst';
  if (accounts >= 2) return 'same-password-many-accounts';
  return null;
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

// Jev: 애매한 경보 하나의 확신도(0~1)를 돌려주는 판단 함수입니다.
// 실제 Jev 를 연결하게 되면 이 함수만 바꿉니다. 숫자 하나를 돌려주고, 답이 없으면 던지거나 null 을 돌려줍니다.
async function askJev(row, evidence) {
  const byFailures = evidence.failures >= 30 ? 1 : evidence.failures >= 10 ? 0.8 : evidence.failures >= 3 ? 0.5 : evidence.failures >= 1 ? 0.2 : 0;
  const byAccounts = evidence.accounts >= 8 ? 1 : evidence.accounts >= 5 ? 0.85 : evidence.accounts >= 2 ? 0.5 : 0;
  const level = row.level;
  const byLevel = level === null ? 0 : level >= 10 ? 1 : level >= 5 ? 0.6 : level === 4 ? 0.3 : 0;
  return Math.round(((Math.max(byFailures, byAccounts) + byLevel) / 2) * 100) / 100;
}

// Jev 에게 묻되, 오래 걸리거나 오류가 나거나 0~1 숫자가 아니면 "응답 없음"(null)으로 봅니다.
async function askWithTimeout(row, evidence) {
  let timer;
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => askJev(row, evidence)),
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
  const patterns = await loadPatterns();
  if (patterns === null) {
    return { action: 'alert', confidence: ALERT_AT, reason: '패턴 파일을 읽지 못해 알림으로만 남깁니다' };
  }

  const row = extractAlert(alert);
  const evidence = evidenceOf(alert, row);
  const patternId = matchPattern(evidence);
  const patternName = patternId === null ? null : patterns.get(patternId);
  const basis = patternName === null ? '근거 패턴 없음' : `근거 패턴: ${patternName}`;
  const level = row.level;

  // 명확한 공격: 규칙 수준이 높고(10 이상) 로그인 실패의 증거가 있으면 바로 block.
  // 증거는 패턴과 맞는 건수·계정 수이거나, 숫자가 없어도 설명이 로그인 실패·여러 계정 대입을 말하는 경우입니다.
  const text = row.description ?? '';
  const manyAccountsWording = /(여러|서로 다른)\s*계정|같은 비밀번호/.test(text);
  const heavyVolume = evidence.failures >= HEAVY_FAILURES || evidence.accounts >= HEAVY_ACCOUNTS;
  if ((level !== null && level >= CLEAR_LEVEL && (patternId !== null || text.includes('실패') || manyAccountsWording)) || (patternId !== null && heavyVolume)) {
    const clearId = patternId ?? (manyAccountsWording ? PATTERN_IDS[1] : PATTERN_IDS[0]);
    return { action: 'block', confidence: CLEAR_CONFIDENCE, reason: `근거 패턴: ${patterns.get(clearId)}` };
  }

  // 정상: 맞는 패턴이 없고 경보 수준이 낮으면 바로 record.
  if (patternName === null && (level === null || level <= NORMAL_LEVEL)) {
    return { action: 'record', confidence: 0, reason: basis };
  }

  // 애매한 경보만 Jev 에게 묻습니다. 응답이 없으면 alert.
  const confidence = await askWithTimeout(row, evidence);
  if (confidence === null) {
    return { action: 'alert', confidence: ALERT_AT, reason: `${basis} (Jev 응답 없음)` };
  }
  return { action: actionFor(confidence), confidence, reason: basis };
}
