// 보너스 「권한 가로채기」: 경보를 패턴과 맞춰 block / alert / record 로 판단하는 모듈입니다.
// 이 파일은 다른 파일이나 패키지를 불러오지 않고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고 혼자 계산합니다.
// 아래 PATTERNS 는 xdr/privilege/patterns.json 의 내용을 그대로 옮겨 적은 것입니다(근거와 조건은 그 파일 설명 참고).

const PATTERNS = Object.freeze({
  "schema": "aleph.xdr.patterns.v1",
  "moduleKey": "privilege",
  "techniques": [
    "T1078",
    "T1098.007",
    "T1068"
  ],
  "references": {
    "T1078": "https://attack.mitre.org/techniques/T1078/",
    "T1098.007": "https://attack.mitre.org/techniques/T1098/007/",
    "T1068": "https://attack.mitre.org/techniques/T1068/"
  },
  "patterns": [
    {
      "id": "admin-group-add",
      "name": "관리자 그룹 추가",
      "condition": "경보 설명(rule.description)이 계정이 관리자 그룹에 추가됐거나 관리자 그룹에 들어갔다고 말하고, 그룹 이름 칸(data.group)이 있으면 administrators 입니다. 같은 주소에서 계정 여러 개가 추가되거나 빠졌다 다시 들어오면 횟수는 data.count 에서 읽습니다. 과제 그룹·수업 그룹처럼 관리자가 아닌 그룹에 추가된 것, 새 로컬 그룹 만들기, 그룹 목록 읽기, 관리자 그룹이 아니라는 문장은 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1098.007(Account Manipulation: Additional Local or Domain Groups): 공격자가 자기가 쓰는 계정을 Administrators 같은 권한 그룹에 넣어 접근을 유지하며, 탐지는 권한 그룹에 승인 없이 계정이 추가되는 것을 봅니다(이 번호는 이번 프롬프트가 준 T1068·T1078 이 아니라 별도 기법)."
    },
    {
      "id": "unfamiliar-admin-command",
      "name": "처음 보는 관리자 명령",
      "condition": "경보 설명이 방금 관리자가 된 계정이나 평범한 계정이 관리자 명령·권한 명령을 실행했다고 말하고, 처음 보는 주소나 수업 시간 밖이 함께 적혀 있습니다. 평소 주소에서 한 번 실행됐다는 문장, 관리자 명령이 실패 1건으로 끝났다는 문장, 권한 상승 창이 떴다가 취소됐다는 문장은 단독으로는 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1078(Valid Accounts): 공격자가 기존 계정의 자격으로 권한 상승에 쓰며, 탐지는 평소와 다른 환경에서의 로그온과 뒤따르는 예상 밖 하위 프로세스를 봅니다(관리자 명령·처음 보는 주소 조건은 경보 설명에 따른 것)."
    },
    {
      "id": "off-hours-privilege-use",
      "name": "업무 시간 밖 권한 사용",
      "condition": "경보 설명이 수업 시간 밖이나 업무처럼 보이지 않는 시각에 관리자 그룹 추가·관리자 명령 실행 같은 권한 사용이 있었다고 말합니다. 수업 시간 안의 권한 상승 창, 평소 시각의 평범한 로그인·로그아웃은 해당하지 않습니다. 시각 자체(timestamp)는 이 모듈이 시간대를 확인할 방법이 없어 판단에 쓰지 않고 설명 문장에서만 읽습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1078(Valid Accounts): 탐지 항목에 서비스·사용자 계정이 평소와 다른 시각에 로그인하거나 시간 기준으로 어긋나는 활동이 들어 있습니다(수업 시간 기준은 경보 설명에 따른 것)."
    },
    {
      "id": "borrowed-account-privilege",
      "name": "다른 계정 권한으로 관리자 실행",
      "condition": "경보 설명이 다른 계정의 권한으로 관리자 명령을 실행했거나, 세션이 관리자 권한으로 바뀌었고 요청 주소가 처음이라고 말합니다. 자기 계정 종류를 조회만 한 것이나 자기 세션 정보를 조회한 것은 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1078(Valid Accounts): 공격자가 기존 계정의 자격과 권한을 훔쳐 써서 더 높은 권한으로 움직이며, 탐지는 평소 패턴에서 벗어난 계정 사용을 봅니다."
    }
  ],
  "notIncluded": [
    "커널·드라이버·컨테이너의 취약점을 악용한 권한 상승(T1068 본래의 탐지 대상): 이 경보 묶음에는 그런 칸이 없고, 경보의 rule.mitre 에 T1068 이 적힌 경보도 설명은 관리자 명령 실행이라 T1068 번호만으로는 패턴으로 넣지 않았습니다.",
    "계정 이름(admin01, svc-lab 등)에 admin·svc 가 들어 있다는 것만으로 의심하는 조건: MITRE 문서에서 근거를 찾지 못했고 정상 관리 계정의 평소 로그인 경보가 있어 넣지 않았습니다.",
    "경보 시각(timestamp)의 시·분으로 업무 시간을 직접 판정하는 조건: 근무 시간표가 저장소에 없어 근거 없이 정할 수 없습니다.",
    "어느 계정의 세션을 거둘지 정하는 조건: 탐지 패턴이 아니라 대응 방식이라 이 파일에는 넣지 않고 연결 단계에서 정합니다."
  ]
});

// ---- 판단 ----------------------------------------------------------------
// 아래 숫자(확신도 값, 규칙 수준 기준, 길이 제한)는 문서에 없어서 경보 묶음의 모양을 보고 내가 정한 짐작입니다.
// 경보에서 읽는 칸은 rule.description, rule.level, data.group, data.count 네 개뿐입니다.
// 계정 이름(data.srcuser), PC 이름(agent.name), 시각(timestamp)으로는 판단하지 않습니다
// (관리 계정 admin01·svc-lab 이 정상 경보에도 나오고, 업무 시간표가 저장소에 없습니다).

const BLOCK_AT = 0.85; // 이 값 이상이면 block (프롬프트 지시)
const ALERT_AT = 0.5; // 이 값 이상이면 alert, 그 아래는 record (프롬프트 지시)
const MAX_TEXT = 2000; // 칸 하나에서 이 글자 수까지만 봅니다(너무 긴 입력으로 느려지지 않게). 짐작
const WEAK_LEVEL = 5; // 규칙 수준이 이 값 이상이면서 약한 징후가 있으면 alert 후보. 짐작
const STRONG_LEVEL = 8; // 규칙 수준이 이 값 이상일 때만 뚜렷한 패턴으로 인정합니다. 짐작
const CAP = 0.99; // 확신도 위쪽 한계
const WEAK_CAP = 0.8; // 약한 징후만 있는 경우의 위쪽 한계(block 으로 올라가지 않게). 짐작

const NAME_GROUP = PATTERNS.patterns[0].name;
const NAME_COMMAND = PATTERNS.patterns[1].name;
const NAME_OFF_HOURS = PATTERNS.patterns[2].name;
const NAME_BORROWED = PATTERNS.patterns[3].name;

// 설명 문장에서 읽는 징후(조건은 patterns.json 의 condition 문장을 그대로 모양으로 옮긴 것).
const ADMIN_GROUP_ADD = /관리자 그룹(?:에서|에|으로)?[^.]{0,20}?(?:추가|들어가|들어왔)/;
const ADMIN_REENTER = /다시 관리자로 들어왔/;
const NOT_ADMIN_GROUP = /관리자 그룹(?:은|이) 아닙니다/;
const ADMIN_COMMAND = /(?:관리자|권한) 명령[^.]{0,12}실행/;
const JUST_ADMIN = /(?:방금 관리자가 된|평범한 계정)/;
const NEW_ADDRESS = /처음 보는 주소|요청 주소는 처음/;
const OFF_HOURS = /(?:수업 시간 밖|업무처럼 보이지 않는 시각)/;
const BORROWED = /다른 계정의 권한으로/;
const SESSION_TO_ADMIN = /세션이 관리자 권한으로 바뀌었/;
const REMOTE_ADDRESS = /원격 주소/;
const SEQUENCE = /(?:곧바로|같이 있습니다)/;
// 약한 징후(뚜렷한 패턴이 없을 때 알림 후보를 가르는 낱말).
const IDENTITY_WORD = /(?:계정|세션|권한|그룹|관리자)/;
const PRIVILEGE_WORD = /(?:권한 상승|관리자 명령|권한 명령|관리자 그룹|관리자 권한)/;

function textOf(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

function groupOf(alert) {
  return textOf(alert?.data?.group).trim().toLowerCase();
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
    const group = groupOf(alert);
    const bonus = levelBonus(level);
    const adminGroupField = group === 'administrators';

    // 1) 뚜렷한 경우: 패턴마다 기본 확신도를 주고, 같이 적힌 징후와 규칙 수준으로 조금씩 올립니다(기본값은 짐작).
    const hits = [];
    if (level >= STRONG_LEVEL) {
      const groupAdd = !NOT_ADMIN_GROUP.test(description) && (ADMIN_GROUP_ADD.test(description) || ADMIN_REENTER.test(description));
      const adminCommand = ADMIN_COMMAND.test(description);
      const newAddress = NEW_ADDRESS.test(description);
      const offHours = OFF_HOURS.test(description);

      // 패턴 1: 관리자 그룹 추가
      if (groupAdd) {
        let value = 0.78 + bonus;
        if (adminGroupField) value += 0.04;
        if (repeatCount(alert) >= 2) value += 0.03; // 여러 계정 추가 또는 빠졌다 다시 들어옴
        if (REMOTE_ADDRESS.test(description)) value += 0.03;
        if (SEQUENCE.test(description)) value += 0.04; // 추가 직후 명령 실행
        hits.push({ name: NAME_GROUP, value });
      }
      // 패턴 2: 처음 보는 관리자 명령 (방금 관리자가 됐거나 평범한 계정, 처음 보는 주소, 수업 시간 밖 중 하나 이상이 함께 있어야 함)
      if (adminCommand && (JUST_ADMIN.test(description) || newAddress || offHours)) {
        let value = 0.76 + bonus;
        if (JUST_ADMIN.test(description)) value += 0.06;
        if (newAddress) value += 0.06;
        if (offHours) value += 0.08;
        hits.push({ name: NAME_COMMAND, value });
      }
      // 패턴 3: 업무 시간 밖 권한 사용
      if (offHours && (adminCommand || groupAdd || PRIVILEGE_WORD.test(description))) {
        hits.push({ name: NAME_OFF_HOURS, value: 0.78 + bonus + (adminGroupField ? 0.04 : 0) });
      }
      // 패턴 4: 다른 계정 권한으로 관리자 실행 / 세션이 관리자 권한으로 바뀌고 처음 보는 주소
      if (BORROWED.test(description)) {
        hits.push({ name: NAME_BORROWED, value: 0.8 + bonus + (adminCommand ? 0.04 : 0) });
      } else if (SESSION_TO_ADMIN.test(description) && newAddress) {
        hits.push({ name: NAME_BORROWED, value: 0.78 + bonus + 0.06 });
      }
    }
    if (hits.length > 0) {
      hits.sort((a, b) => b.value - a.value);
      const confidence = Math.min(CAP, hits[0].value + 0.02 * (hits.length - 1));
      return finish(actionFor(confidence), confidence, hits.map((hit) => hit.name).join(' + '));
    }

    // 2) 약한 징후: 계정·세션·권한·그룹 낱말, 권한 상승·관리자 명령 낱말, 그룹 이름 칸. 규칙 수준이 낮으면 올리지 않습니다.
    const signs = [IDENTITY_WORD.test(description), PRIVILEGE_WORD.test(description), group !== ''].filter(Boolean).length;
    if (signs > 0 && level >= WEAK_LEVEL) {
      const confidence = Math.min(WEAK_CAP, 0.5 + 0.04 * Math.min(signs, 3) + 0.02 * Math.min(level - WEAK_LEVEL, 3));
      const where = /그룹/.test(description) || group !== '' ? NAME_GROUP : NAME_COMMAND;
      return finish(actionFor(confidence), confidence, `${where} 패턴과 일부만 닮음`);
    }
    if (signs > 0) return finish('record', 0.3, '징후는 있으나 규칙 수준이 낮아 패턴과 맞지 않음');

    return finish('record', level >= WEAK_LEVEL ? 0.2 : 0.05, '맞는 패턴 없음');
  } catch {
    // 어떤 입력이 와도 던지지 않고 기록으로 돌려줍니다.
    return finish('record', 0, '경보를 읽을 수 없어 기록만 남김');
  }
}
