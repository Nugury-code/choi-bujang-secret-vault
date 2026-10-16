// 보너스 「몰래 심어진 프로그램」: 경보를 패턴과 맞춰 block / alert / record 로 판단하는 모듈입니다.
// 이 파일은 다른 파일이나 패키지를 불러오지 않고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고 혼자 계산합니다.
// 아래 PATTERNS 는 xdr/persistence/patterns.json 의 내용을 그대로 옮겨 적은 것입니다(근거와 조건은 그 파일 설명 참고).

const PATTERNS = Object.freeze({
  "schema": "aleph.xdr.patterns.v1",
  "moduleKey": "persistence",
  "techniques": [
    "T1543",
    "T1053",
    "T1547.001"
  ],
  "references": {
    "T1543": "https://attack.mitre.org/techniques/T1543/",
    "T1053": "https://attack.mitre.org/techniques/T1053/",
    "T1547.001": "https://attack.mitre.org/techniques/T1547/001/"
  },
  "patterns": [
    {
      "id": "unsigned-new-service",
      "name": "서명 없는 새 서비스 등록",
      "condition": "경보 설명(rule.description)이 평소 목록에 없는 새 서비스가 서명 없이 등록됐거나 서비스 실행 파일이 서명 없이 바뀌었다고 말하고, 실행 파일 경로(data.path)가 있으면 사용자 임시 폴더(AppData\\Local\\Temp) 안입니다. 같은 주소에서 연속 등록이면 반복 횟수는 data.count 에서 읽습니다. 서명이 확인되지 않았다거나 아직 모른다는 문장, 기존 서비스가 서명된 채 실행 중이라는 문장은 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1543(Create or Modify System Process): 공격자가 서비스 같은 시스템 프로세스를 만들거나 바꿔 페이로드를 계속 실행하게 하며, 코드 서명 강제(M1045)가 완화책입니다(서명·임시 폴더 조건은 MITRE 탐지 문장이 아니라 이번 경보 설명에 따른 것)."
    },
    {
      "id": "unfamiliar-scheduled-task",
      "name": "낯선 예약 작업",
      "condition": "경보 설명이 처음 보는 예약 작업, 임의 문자열 이름의 예약 작업, 수업 시간 밖 실행을 말하고, 실행 파일 경로(data.path)가 있으면 사용자 임시 폴더 안입니다. 기존 예약 작업의 평소 실행 완료, 수업 시간 안의 예약 작업 하나, 운영체제 업데이트 예약은 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1053(Scheduled Task/Job): 공격자가 내장 예약 도구로 악성 코드를 반복 실행해 지속성을 얻으며, 탐지는 예약 작업 생성·변경 뒤에 튀는 프로세스가 실행되는 것을 봅니다(임시 폴더·수업 시간 조건은 경보 설명에 따른 것)."
    },
    {
      "id": "startup-folder-change",
      "name": "시작 폴더 변경",
      "condition": "경보 설명이 시작 폴더(시작 프로그램)에 평소 목록에 없는 프로그램이 추가됐다고 말하거나, 시작 항목과 예약 작업이 같은 임시 파일을 함께 가리킵니다. 시작 프로그램 목록을 읽기만 한 것, 이름만 수업 도구와 비슷한 항목, 변경 뒤 실행 기록이 없는 변경은 단독으로는 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1547.001(Registry Run Keys / Startup Folder): 시작 폴더에 프로그램을 두면 로그인 때마다 실행되어 지속성이 되며, 이번 프롬프트가 준 T1543·T1053 이 아니라 별도 기법 번호입니다."
    }
  ],
  "notIncluded": [
    "임시 폴더에 실행 파일이 생겼다는 사실만 있는 경보(서비스 등록·예약 작업·시작 폴더 변경 없음): 지속성 설치의 근거가 되지 않아 패턴으로 넣지 않았습니다.",
    "서비스가 멈췄다가 같은 파일로 다시 시작된 경보: 새로 등록된 것이 아니라 근거가 없어 넣지 않았습니다.",
    "계정 이름(svc-lab 등)만으로 정상·악성을 가르는 조건: MITRE 문서에서 근거를 찾지 못해 넣지 않았습니다.",
    "출발 주소나 agent.name 으로 어느 PC 를 격리할지 정하는 조건: 탐지 패턴이 아니라 대응 방식이라 이 파일에는 넣지 않고 연결 단계에서 정합니다."
  ]
});

// ---- 판단 ----------------------------------------------------------------
// 아래 숫자(확신도 값, 규칙 수준 기준, 길이 제한)는 문서에 없어서 경보 묶음의 모양을 보고 내가 정한 짐작입니다.
// 경보에서 읽는 칸은 rule.description, rule.level, data.path, data.count 네 개뿐입니다.
// 계정 이름(data.srcuser)과 PC 이름(agent.name)으로는 판단하지 않습니다(서비스 계정이 정상에도 애매한 경보에도 나옵니다).

const BLOCK_AT = 0.85; // 이 값 이상이면 block (프롬프트 지시)
const ALERT_AT = 0.5; // 이 값 이상이면 alert, 그 아래는 record (프롬프트 지시)
const MAX_TEXT = 2000; // 칸 하나에서 이 글자 수까지만 봅니다(너무 긴 입력으로 느려지지 않게). 짐작
const WEAK_LEVEL = 5; // 규칙 수준이 이 값 이상이면서 약한 징후가 있으면 alert 후보. 짐작
const CAP = 0.99; // 확신도 위쪽 한계
const WEAK_CAP = 0.8; // 약한 징후만 있는 경우의 위쪽 한계(block 으로 올라가지 않게). 짐작

const NAME_SERVICE = PATTERNS.patterns[0].name;
const NAME_TASK = PATTERNS.patterns[1].name;
const NAME_STARTUP = PATTERNS.patterns[2].name;

// 설명 문장에서 읽는 징후(조건은 patterns.json 의 condition 문장을 그대로 모양으로 옮긴 것).
const NEW_SERVICE = /(?:새 서비스|서비스 등록(?!은 없|이 없)|서비스 실행 파일이 바뀌|서비스(?:가|를)[^.]{0,20}등록됐)/;
const SERVICE_WORD = /서비스/;
const UNSIGNED = /서명(?:이|은)? 없/; // "서명이 없습니다", "서명 없는"만 해당. "서명은 확인되지 않았습니다", "서명된 채"는 해당하지 않음
const NOT_IN_LIST = /평소 목록에 없/;
const STAYS = /다시 켜도 남도록/;
const NEW_TASK = /(?:처음 보는 예약 작업|임의 문자열)/;
const RANDOM_NAME = /임의 문자열/;
const OFF_HOURS = /수업 시간 밖/;
const TASK_WORD = /예약/;
const STARTUP_ADD = /시작 (?:폴더|프로그램|항목)[^.]{0,30}(?:추가됐|가리킵니다)/;
const STARTUP_WORD = /시작 (?:폴더|프로그램|항목)/;
const SAME_FILE = /같은 임시 파일/;
const SIGN_WORD = /서명/;
// 임시 폴더·시작 폴더 안의 경로(윈도 경로. 비교하기 쉽게 소문자와 역슬래시로 맞춘 뒤 봅니다).
const TEMP_PATH = /\\appdata\\local\\temp\\/;
const STARTUP_PATH = /\\start menu\\programs\\startup\\/;

function textOf(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

function pathOf(alert) {
  const raw = alert?.data?.path;
  return textOf(raw).replace(/\//g, '\\').toLowerCase();
}

function repeatCount(alert) {
  const raw = alert?.data?.count;
  const number = typeof raw === 'number' ? raw : Number.parseInt(typeof raw === 'string' ? raw : '', 10);
  return Number.isFinite(number) && number >= 0 && number <= 1000000 ? number : 0;
}

function levelOf(alert) {
  const level = alert?.rule?.level;
  return typeof level === 'number' && Number.isFinite(level) ? level : 0;
}

// 규칙 수준이 9 이상일 때 한 단계마다 0.01 씩, 최대 0.04. 짐작
function levelBonus(level) {
  return Math.min(0.04, Math.max(0, 0.01 * (level - 8)));
}

function finish(action, confidence, reason) {
  const value = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
  return { action, confidence: value, reason: String(reason).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 160) };
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

export function decide(alert) {
  try {
    const description = textOf(alert?.rule?.description);
    const level = levelOf(alert);
    const path = pathOf(alert);
    const inTemp = TEMP_PATH.test(path);
    const inStartup = STARTUP_PATH.test(path);

    // 1) 뚜렷한 경우: 패턴마다 기본 확신도를 주고, 임시 폴더 경로·반복·규칙 수준으로 조금씩 올립니다(기본값은 짐작).
    const hits = [];
    // 패턴 1: 서명 없는 새 서비스 등록 (새 서비스 + 서명 없음, 또는 새 서비스 + 평소 목록에 없음 + 다시 켜도 남도록)
    if (NEW_SERVICE.test(description) && (UNSIGNED.test(description) || (NOT_IN_LIST.test(description) && STAYS.test(description)))) {
      let value = UNSIGNED.test(description) ? 0.8 : 0.78;
      if (inTemp) value += 0.07;
      if (repeatCount(alert) >= 3) value += 0.03; // 같은 주소에서 연속 등록
      hits.push({ name: NAME_SERVICE, value: value + levelBonus(level) });
    }
    // 패턴 2: 낯선 예약 작업 (처음 보는 / 임의 문자열 이름)
    if (NEW_TASK.test(description)) {
      let value = 0.75;
      if (RANDOM_NAME.test(description)) value += 0.05;
      if (OFF_HOURS.test(description)) value += 0.1;
      if (inTemp) value += 0.07;
      hits.push({ name: NAME_TASK, value: value + levelBonus(level) });
    }
    // 패턴 3: 시작 폴더 변경 (평소 목록에 없는 프로그램 추가, 또는 시작 항목과 예약 작업이 같은 임시 파일을 가리킴)
    if (SAME_FILE.test(description) && STARTUP_WORD.test(description)) {
      hits.push({ name: `${NAME_STARTUP} + ${NAME_TASK}`, value: 0.85 + (inTemp ? 0.07 : 0) + levelBonus(level) });
    } else if (STARTUP_ADD.test(description) && NOT_IN_LIST.test(description)) {
      hits.push({ name: NAME_STARTUP, value: 0.78 + (inStartup ? 0.07 : 0) + levelBonus(level) });
    }
    if (hits.length > 0) {
      hits.sort((a, b) => b.value - a.value);
      const confidence = Math.min(CAP, hits[0].value + 0.02 * (hits.length - 1));
      return finish(actionFor(confidence), confidence, hits.map((hit) => hit.name).join(' + '));
    }

    // 2) 약한 징후: 서비스·예약·시작 항목 낱말, 서명 낱말, 임시 폴더 경로. 규칙 수준이 낮으면 올리지 않습니다.
    const kinds = [
      [SERVICE_WORD.test(description), NAME_SERVICE],
      [TASK_WORD.test(description), NAME_TASK],
      [STARTUP_WORD.test(description) || inStartup, NAME_STARTUP],
    ].filter((kind) => kind[0]);
    const signs = kinds.length + (SIGN_WORD.test(description) ? 1 : 0) + (inTemp ? 1 : 0);
    if (signs > 0 && level >= WEAK_LEVEL) {
      const confidence = Math.min(WEAK_CAP, 0.5 + 0.04 * Math.min(signs, 3) + 0.02 * Math.min(level - WEAK_LEVEL, 3));
      const where = kinds.length > 0 ? kinds[0][1] : NAME_SERVICE;
      return finish(actionFor(confidence), confidence, `${where}과 일부만 닮음`);
    }
    if (signs > 0) return finish('record', 0.3, '징후는 있으나 규칙 수준이 낮아 패턴과 맞지 않음');

    return finish('record', level >= WEAK_LEVEL ? 0.2 : 0.05, '맞는 패턴 없음');
  } catch {
    // 어떤 입력이 와도 던지지 않고 기록으로 돌려줍니다.
    return finish('record', 0, '경보를 읽을 수 없어 기록만 남김');
  }
}
