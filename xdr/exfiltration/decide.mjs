// 보너스 「자료 빼돌리기」: 경보를 패턴과 맞춰 block / alert / record 로 판단하는 모듈입니다.
// 이 파일은 다른 파일이나 패키지를 불러오지 않고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고 혼자 계산합니다.
// 아래 PATTERNS 는 xdr/exfiltration/patterns.json 의 내용을 그대로 옮겨 적은 것입니다(근거와 조건은 그 파일 설명 참고).

const PATTERNS = Object.freeze({
  "schema": "aleph.xdr.patterns.v1",
  "moduleKey": "exfiltration",
  "techniques": [
    "T1048",
    "T1041",
    "T1560"
  ],
  "references": {
    "T1048": "https://attack.mitre.org/techniques/T1048/",
    "T1041": "https://attack.mitre.org/techniques/T1041/",
    "T1560": "https://attack.mitre.org/techniques/T1560/"
  },
  "patterns": [
    {
      "id": "new-destination-bulk-transfer",
      "name": "처음 보는 목적지로 대용량 전송",
      "condition": "경보 설명(rule.description)이 처음 보는 목적지나 주소로 자료가 나갔다고 말하고, 전송 크기(data.bytes)가 크거나 한 번에 나간 파일 수(data.files) 또는 반복 횟수(data.count)가 많습니다. 자료실 전체 복사나 같은 압축 파일이 목적지 두 곳으로 나간 경우도 포함합니다. 목적지가 수업 자료 주소나 평소 목적지라는 문장, 작은 전송, 전송이 실패로 끝났다는 문장은 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1048(Exfiltration Over Alternative Protocol): 공격자가 명령 통로가 아닌 다른 경로·다른 위치로 자료를 빼내며, 탐지는 평소 기준에 없는 외부 전송과 많은 양을 봅니다(「처음 보는 목적지」 낱말은 경보 설명에 따른 것)."
    },
    {
      "id": "off-hours-archive-exfil",
      "name": "업무 시간 밖 압축 파일 반출",
      "condition": "경보 설명이 수업 시간 밖이나 업무 시간 밖에 압축 파일이 처음 보는 주소로 나갔다고 말하거나, 압축 파일 여러 개가 연속으로 올라갔다고 말합니다. 압축 파일을 만들기만 했고 외부 전송이 없다는 문장, 압축 파일을 연 뒤 일부만 나간 문장은 단독으로는 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1048(탐지에 평소와 다른 시각의 외부 전송이 나옴)과 T1560(Archive Collected Data): 공격자는 반출 전에 자료를 압축·암호화합니다. T1560 은 이번 프롬프트가 준 근거가 아니라 압축 신호를 위해 따로 찾은 기법 번호입니다."
    },
    {
      "id": "command-channel-transfer",
      "name": "명령 통로로 큰 파일 전송",
      "condition": "경보 설명이 명령 통로로 큰 파일이 처음 보는 목적지에 반복 전송됐다고 말하거나, 같은 목적지로 대용량 전송이 여러 번 반복됐다고 말하고 반복 횟수(data.count)가 많습니다. 명령 통로에 짧은 자료 이름만 몇 번 보인 경우(큰 파일 아님)는 해당하지 않습니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1041(Exfiltration Over C2 Channel): 공격자가 이미 쓰는 명령 통로(C2)의 평소 통신 안에 훔친 자료를 넣어 보냅니다(명령 통로 낱말과 반복 조건은 경보 설명에 따른 것)."
    },
    {
      "id": "unusual-port-transfer",
      "name": "평소 쓰지 않던 포트 전송",
      "condition": "경보 설명이 평소에 쓰지 않던 포트나 경로로 자료 이름이 연속 전송됐다고 말하고, 전송 크기(data.bytes)나 파일 수(data.files)가 큽니다. 포트 얘기 없이 크기만 큰 경우는 이 패턴이 아닙니다. 수치 기준은 decide 단계에서 정합니다.",
      "basis": "MITRE ATT&CK T1048(명령 통로가 아닌 다른 프로토콜로 자료를 보내며, 탐지에 평소 기준 밖의 흔치 않은 프로토콜 전송이 나옴)(포트라는 낱말은 경보 설명에 따른 것)."
    }
  ],
  "notIncluded": [
    "목적지가 수업 자료 주소·자료실·평소 목적지라는 문장만 있는 경보: 평소 전송이라 유출의 근거가 되지 않아 넣지 않았습니다.",
    "전송 크기만 크고 목적지·시각·압축·포트 같은 다른 신호가 없는 경보: 크기 하나로는 근거를 찾지 못해 패턴으로 넣지 않았습니다.",
    "압축 파일을 만들었지만 외부 전송이 없는 경보, 전송이 실패로 끝난 경보: 반출이 일어난 근거가 아니라 넣지 않았습니다.",
    "계정 이름(svc-lab 등)이나 출발 주소만으로 정상·악성을 가르는 조건: MITRE 문서에서 근거를 찾지 못해 넣지 않았습니다.",
    "어느 목적지를 막을지 정하는 조건: 탐지 패턴이 아니라 대응 방식이라 이 파일에는 넣지 않고 연결 단계에서 정합니다."
  ]
});

// ---- 판단 ----------------------------------------------------------------
// 아래 숫자(확신도 값, 크기 기준, 규칙 수준 기준, 길이 제한)는 문서에 없어서 경보 묶음의 모양을 보고 내가 정한 짐작입니다.
// 경보에서 읽는 칸은 rule.description, rule.level, data.bytes, data.files, data.count 다섯 개뿐입니다.
// 계정 이름(data.srcuser)·출발 주소·목적지 주소(data.dstip)·PC 이름(agent.name)과 rule.mitre 번호로는 판단하지 않습니다.

const BLOCK_AT = 0.85; // 이 값 이상이면 block (프롬프트 지시)
const ALERT_AT = 0.5; // 이 값 이상이면 alert, 그 아래는 record (프롬프트 지시)
const MAX_TEXT = 2000; // 칸 하나에서 이 글자 수까지만 봅니다(너무 긴 입력으로 느려지지 않게). 짐작
const STRONG_LEVEL = 8; // 뚜렷한 패턴은 규칙 수준이 이 값 이상일 때만 인정. 짐작
const WEAK_LEVEL = 5; // 규칙 수준이 이 값 이상이면서 약한 징후가 있으면 alert 후보. 짐작
const BIG_BYTES = 50000000; // 전송 크기가 이 값 이상이면 대용량(약 50MB). 짐작
const SOME_BYTES = 1000000; // 약한 징후로 세는 크기(약 1MB). 짐작
const MANY_FILES = 50; // 한 번에 나간 파일 수가 이 값 이상이면 많다고 봄. 짐작
const MANY_REPEATS = 5; // 같은 목적지 반복 횟수가 이 값 이상이면 반복이 많다고 봄. 짐작
const CAP = 0.99; // 확신도 위쪽 한계
const WEAK_CAP = 0.8; // 약한 징후만 있는 경우의 위쪽 한계(block 으로 올라가지 않게). 짐작

const NAME_BULK = PATTERNS.patterns[0].name;
const NAME_ARCHIVE = PATTERNS.patterns[1].name;
const NAME_COMMAND = PATTERNS.patterns[2].name;
const NAME_PORT = PATTERNS.patterns[3].name;

// 설명 문장에서 읽는 징후(조건은 patterns.json 의 condition 문장을 그대로 모양으로 옮긴 것).
const NEW_DEST = /(?:처음 보는 (?:목적지|주소)|자료실 전체[^.]{0,12}(?:외부|복사))/;
const SENT = /(?:나갔|올라갔|복사됐|전송됐|전송이 [^.]{0,6}번)/;
const NOT_SENT = /(?:전송은 아직 없|전송이 실패|실패 \d+건)/; // 전송이 없었거나 실패한 경우
const KNOWN_DEST = /(?:수업 자료 주소|평소 목적지|자료실입니다)/; // 평소 목적지라는 문장
const SMALL = /(?:큰 파일은 아닙니다|작은 )/;
const ARCHIVE = /압축 파일/;
const ARCHIVE_ONLY_MADE = /(?:만들었|연 뒤)/;
const OFF_HOURS = /(?:수업|업무) 시간 밖/;
const SEQUENCE = /연속/;
const SAME_DEST = /같은 목적지/;
const COMMAND_CHANNEL = /명령 통로/;
const REPEAT = /(?:반복|\d+번)/;
const PORT = /(?:쓰지 않던|흔치 않은|평소와 다른) 포트/;
const TWO_PLACES = /두 곳/;
const AT_ONCE = /한 번에/;
// 약한 징후 낱말.
const DEST_WORD = /(?:목적지|주소)/;
const SEND_WORD = /(?:전송|나갔|올라갔|복사)/;
const ARCHIVE_WORD = /압축/;
const CHANNEL_WORD = /(?:포트|명령 통로)/;

function textOf(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

function numberOf(raw) {
  const number = typeof raw === 'number' ? raw : Number.parseInt(typeof raw === 'string' ? raw : '', 10);
  return Number.isFinite(number) && number >= 0 && number <= 1e15 ? number : 0;
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
    const bytes = numberOf(alert?.data?.bytes);
    const files = numberOf(alert?.data?.files);
    const count = numberOf(alert?.data?.count);
    const big = bytes >= BIG_BYTES;
    const sentOut = SENT.test(description) && !NOT_SENT.test(description) && !KNOWN_DEST.test(description) && !SMALL.test(description);

    // 1) 뚜렷한 경우: 규칙 수준이 높고 설명이 패턴과 맞으며 크기·파일 수·반복이 큰 경우만. 기본값은 짐작.
    const hits = [];
    if (level >= STRONG_LEVEL && sentOut) {
      // 패턴 1: 처음 보는 목적지로 대용량 전송
      if (NEW_DEST.test(description) && (big || files >= MANY_FILES || count >= MANY_REPEATS)) {
        let value = 0.76;
        if (big) value += 0.08;
        if (files >= MANY_FILES) value += 0.04;
        if (TWO_PLACES.test(description) || AT_ONCE.test(description)) value += 0.02;
        if (/자료실 전체/.test(description)) value += 0.03;
        hits.push({ name: NAME_BULK, value: value + levelBonus(level) });
      }
      // 패턴 2: 업무 시간 밖(또는 연속) 압축 파일 반출
      if (ARCHIVE.test(description) && !ARCHIVE_ONLY_MADE.test(description) && (OFF_HOURS.test(description) || SEQUENCE.test(description))) {
        let value = 0.78;
        if (OFF_HOURS.test(description)) value += 0.06;
        if (big) value += 0.04;
        if (NEW_DEST.test(description)) value += 0.03;
        hits.push({ name: NAME_ARCHIVE, value: value + levelBonus(level) });
      }
      // 패턴 3: 명령 통로 / 같은 목적지로 큰 전송 반복
      if ((COMMAND_CHANNEL.test(description) || SAME_DEST.test(description)) && (REPEAT.test(description) || count >= MANY_REPEATS) && big) {
        let value = 0.78 + 0.04; // 대용량
        if (COMMAND_CHANNEL.test(description)) value += 0.04;
        if (count >= 8) value += 0.03;
        if (OFF_HOURS.test(description)) value += 0.05;
        hits.push({ name: NAME_COMMAND, value: value + levelBonus(level) });
      }
      // 패턴 4: 평소 쓰지 않던 포트 전송
      if (PORT.test(description) && (big || files >= 30)) {
        let value = 0.78;
        if (big) value += 0.04;
        if (files >= 30) value += 0.03;
        hits.push({ name: NAME_PORT, value: value + levelBonus(level) });
      }
    }
    if (hits.length > 0) {
      hits.sort((a, b) => b.value - a.value);
      const confidence = Math.min(CAP, hits[0].value + 0.02 * (hits.length - 1));
      return finish(actionFor(confidence), confidence, hits.map((hit) => hit.name).join(' + '));
    }

    // 2) 약한 징후: 목적지·전송·압축·포트 낱말, 어느 정도 큰 전송. 규칙 수준이 낮으면 올리지 않습니다.
    const kinds = [
      [ARCHIVE_WORD.test(description), NAME_ARCHIVE],
      [CHANNEL_WORD.test(description), PORT.test(description) ? NAME_PORT : NAME_COMMAND],
      [DEST_WORD.test(description) || SEND_WORD.test(description) || bytes >= SOME_BYTES, NAME_BULK],
    ].filter((kind) => kind[0]);
    const signs = (DEST_WORD.test(description) ? 1 : 0) + (SEND_WORD.test(description) ? 1 : 0)
      + (ARCHIVE_WORD.test(description) ? 1 : 0) + (CHANNEL_WORD.test(description) ? 1 : 0) + (bytes >= SOME_BYTES ? 1 : 0);
    if (signs > 0 && level >= WEAK_LEVEL) {
      const confidence = Math.min(WEAK_CAP, 0.5 + 0.04 * Math.min(signs, 3) + 0.02 * Math.min(level - WEAK_LEVEL, 3));
      const where = kinds.length > 0 ? kinds[0][1] : NAME_BULK;
      return finish(actionFor(confidence), confidence, `${where} 패턴과 일부만 닮음`);
    }
    if (signs > 0) return finish('record', 0.3, '징후는 있으나 규칙 수준이 낮아 패턴과 맞지 않음');

    return finish('record', level >= WEAK_LEVEL ? 0.2 : 0.05, '맞는 패턴 없음');
  } catch {
    // 어떤 입력이 와도 던지지 않고 기록으로 돌려줍니다.
    return finish('record', 0, '경보를 읽을 수 없어 기록만 남김');
  }
}
