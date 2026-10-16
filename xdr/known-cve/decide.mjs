// 보너스 「알려진 취약점 악용」: 경보를 패턴과 맞춰 block / alert / record 로 판단하는 모듈입니다.
// 이 파일은 다른 파일이나 패키지를 불러오지 않고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고 혼자 계산합니다.
// 아래 PATTERNS 는 xdr/known-cve/patterns.json 의 내용을 그대로 옮겨 적은 것입니다(근거와 조건은 그 파일 설명 참고).

const PATTERNS = Object.freeze({
  "schema": "aleph.xdr.patterns.v1",
  "moduleKey": "known-cve",
  "technique": "T1190",
  "reference": "https://attack.mitre.org/techniques/T1190/",
  "cve": "CVE-2021-44228",
  "cveReference": "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
  "patterns": [
    {
      "id": "jndi-lookup-in-header",
      "name": "요청 머리글 안의 원격 조회 구문(jndi 형태)",
      "condition": "요청 머리글 칸(경보의 data.useragent)에 jndi 단어와 원격 조회 방식 이름(예: ldap)이 조회 표기 모양으로 이어져 있습니다. jndi 라는 단어나 CVE 번호만 글자로 있는 것, 중괄호만 있는 것, 잘려서 끝까지 이어지지 않은 것은 해당하지 않습니다. 같은 구문의 반복 횟수는 data.count, 어떤 형태인지는 rule.description 의 문장에서 읽습니다. 반복 횟수의 수치 기준은 decide 단계에서 정합니다.",
      "basis": "NVD CVE-2021-44228: Apache Log4j2 2.0-beta9~2.15.0 에서 공격자가 기록되는 메시지나 인자를 조종할 수 있으면 JNDI 조회로 LDAP 같은 공격자 쪽 서버의 코드를 불러 실행할 수 있고, MITRE ATT&CK T1190 사례 표에도 이 CVE 가 적혀 있습니다(머리글이 기록 대상이라는 부분은 NVD 문장이 아니라 이번 프롬프트와 경보 설명에 따른 것입니다)."
    },
    {
      "id": "jndi-lookup-in-url-param",
      "name": "요청 주소 인자 안의 원격 조회 구문(jndi 형태)",
      "condition": "요청 주소의 인자(경보의 data.url, 물음표 뒤 값)에 jndi 단어와 원격 조회 방식 이름이 조회 표기 모양으로 이어져 있습니다. 글자로 된 단어나 CVE 번호만 있는 검색어, 취약점 문서 주소, 잘린 조각은 해당하지 않습니다. 같은 주소에서의 반복 횟수는 data.count, 어떤 형태인지는 rule.description 의 문장에서 읽습니다. 반복 횟수의 수치 기준은 decide 단계에서 정합니다.",
      "basis": "NVD CVE-2021-44228: 공격자가 로그 메시지의 인자를 조종할 수 있으면 원격 코드 실행으로 이어지고, MITRE ATT&CK T1190(외부 공개 앱 악용)은 공개된 웹 서비스의 약점으로 처음 들어오는 기법이며 사례 표(Magic Hound, APT41 등)에 Log4j 악용이 적혀 있습니다."
    },
    {
      "id": "known-vuln-scanner-probe",
      "name": "알려진 취약점 점검 도구의 흔적",
      "condition": "공격 전에 취약한 서버를 찾는 점검 요청의 흔적입니다. 상태 확인 주소 등에 점검용 인자(예: probe)로 원격 조회 구문이 실려 오거나, rule.description 이 알려진 취약점 점검 흔적을 말합니다. 이 경보 묶음에는 점검 도구의 이름을 담은 칸이 없어서 rule.description 의 문장과 data.url 의 인자 이름으로만 읽습니다. 도구 이름만으로 판단하지 않습니다.",
      "basis": "MITRE ATT&CK T1595.002 취약점 스캔: 공격자가 이용할 수 있는 약점이 있는지 미리 훑는 기법이고, 사례 표에 Log4j(CVE-2021-44228)에 취약한 서버를 찾아낸 사례(Aquatic Panda, Magic Hound)가 있습니다."
    }
  ],
  "notIncluded": [
    "jndi 라는 단어, CVE 번호, 취약점 이름이 글자로만 있는 요청(검색어·노트·문서 주소): 조회 구문이 없어 악용 형태의 근거가 되지 않아 패턴으로 넣지 않았습니다.",
    "점검 도구 이름 목록: 이 경보 묶음의 칸으로는 도구 이름을 확인할 수 없고 근거 문서에서 목록을 확인하지 않아 넣지 않았습니다.",
    "영향받는 Log4j 버전 확인: 요청 경보가 아니라 설치된 소프트웨어 목록에서 보는 신호라 이 경보 묶음의 칸으로는 확인할 수 없어 넣지 않았습니다."
  ]
});

// ---- 판단 ----------------------------------------------------------------
// 이 파일은 다른 파일이나 패키지를 불러오지 않고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고 혼자 계산합니다.
// 아래 숫자(확신도 값, 규칙 수준 기준, 길이 제한)는 문서에 없어서 경보 묶음의 모양을 보고 내가 정한 짐작입니다.

const BLOCK_AT = 0.85; // 이 값 이상이면 block (프롬프트 지시)
const ALERT_AT = 0.5; // 이 값 이상이면 alert, 그 아래는 record (프롬프트 지시)
const MAX_TEXT = 2000; // 칸 하나에서 이 글자 수까지만 봅니다(너무 긴 입력으로 느려지지 않게). 짐작
const WEAK_LEVEL = 5; // 규칙 수준이 이 값 이상이면서 약한 징후가 있으면 alert 후보. 짐작

const NAME_HEADER = PATTERNS.patterns[0].name;
const NAME_URL = PATTERNS.patterns[1].name;
const NAME_SCANNER = PATTERNS.patterns[2].name;

// 원격 조회 구문(jndi 형태)을 알아보는 모양입니다. 문서용 표기 문자열 자체는 이 파일에 적지 않고 조각으로 나눠 씁니다.
// 완전한 형태: 시작 기호 + jndi + 콜론 + 조회 방식 이름(ldap, rmi 등) + 콜론.
const FULL_LOOKUP = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|corba|nis|https?)\s*:/i;
// 잘린 형태: 시작 기호 + jndi 까지만 있고 조회 방식 이름이 이어지지 않음(완전한 구문이 아님).
const PARTIAL_LOOKUP = /\$\{\s*jndi/i;
const JNDI_WORD = /jndi/i;
const CVE_TEXT = /cve-\d{4}-\d{3,}/i;
// 설명 문장에서 읽는 징후 단어(약한 징후). 설명이 "없습니다"라고 부정해도 단어는 잡히므로 약한 징후로만 씁니다.
const DESCRIPTION_WORDS = /(?:cve-\d{4}-\d{3,}|취약점|조회 구문|조회 형태|jndi|log4j|라이브러리|중괄호|점검)/i;
const SCANNER_TRACE = /점검 흔적/;
const SCANNER_PARAM = /[?&](?:probe|scan|check)=/i;

function textOf(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

// 칸 하나를 비교하기 좋게 정리합니다: 퍼센트 인코딩 풀기, 중첩 표기(예: 대소문자 변환·기본값 표기)를 풀어 한 글자로 되돌리기.
// 공격자가 글자를 쪼개 숨기는 흔한 방법을 되돌리기 위한 것입니다(내 짐작, 이번 경보 묶음에는 없음).
function normalize(value) {
  let text = textOf(value);
  try { text = decodeURIComponent(text); } catch { /* 깨진 인코딩은 그대로 둡니다 */ }
  for (let round = 0; round < 3; round += 1) {
    const next = text
      .replace(/\$\{\s*(?:lower|upper)\s*:\s*([^}]{1,3})\}/gi, '$1')
      .replace(/\$\{[^}$]{0,12}?:-([^}$]{0,6})\}/g, '$1');
    if (next === text) break;
    text = next;
  }
  return text.toLowerCase();
}

function dataStrings(alert) {
  const data = alert !== null && typeof alert === 'object' ? alert.data : null;
  const out = [];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'srcip' || key === 'srcuser' || key === 'count') continue;
    if (typeof value === 'string') out.push({ key, text: normalize(value) });
  }
  return out;
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
    const fields = dataStrings(alert);
    const level = levelOf(alert);
    const description = textOf(alert?.rule?.description);
    const url = fields.find((field) => field.key === 'url');
    const others = fields.filter((field) => field.key !== 'url');

    // 1) 뚜렷한 경우: 완전한 원격 조회 구문이 머리글 칸이나 주소 인자에 있음.
    const urlHit = url !== undefined && FULL_LOOKUP.test(url.text);
    const headerHit = others.some((field) => FULL_LOOKUP.test(field.text));
    const scanner = SCANNER_TRACE.test(description) || (url !== undefined && SCANNER_PARAM.test(url.text));
    if (urlHit || headerHit) {
      let confidence = urlHit && headerHit ? 0.97 : 0.9;
      if (repeatCount(alert) >= 3) confidence += 0.03; // 같은 구문 반복
      if (scanner) confidence += 0.02; // 점검 도구 흔적이 함께 있음
      const names = [];
      if (headerHit) names.push(NAME_HEADER);
      if (urlHit) names.push(NAME_URL);
      if (scanner) names.push(NAME_SCANNER);
      return finish(actionFor(Math.min(0.99, confidence)), Math.min(0.99, confidence), names.join(' + '));
    }

    // 2) 설명 문장이 원격 조회 구문이 있다고 말하는데 칸에서는 못 찾은 경우(칸이 비었거나 모양이 다름).
    //    규칙 수준이 높을 때만 block 후보로 봅니다. 부정 문장("없습니다", "아닙니다")이면 이 길로 가지 않습니다.
    const claims = /(?:원격 조회 구문|CVE-2021-44228 형태)/.test(description)
      && !/(?:없습니다|아닙니다|글자만)/.test(description);
    if (claims && level >= 10) {
      return finish('block', 0.88, `${NAME_URL} (칸에서는 못 찾았지만 설명과 규칙 수준이 뚜렷함)`);
    }

    // 3) 점검 도구의 흔적만 있고 구문은 없음.
    if (scanner && level >= WEAK_LEVEL) {
      return finish('alert', 0.65, NAME_SCANNER);
    }

    // 4) 약한 징후: 잘린 구문, jndi 단어, CVE 번호, 설명 속 징후 단어. 규칙 수준이 낮으면 올리지 않습니다.
    const joined = fields.map((field) => field.text).join(' ');
    const signs = [
      PARTIAL_LOOKUP.test(joined),
      JNDI_WORD.test(joined),
      CVE_TEXT.test(joined),
      DESCRIPTION_WORDS.test(description),
    ].filter(Boolean).length;
    if (signs > 0 && level >= WEAK_LEVEL) {
      const confidence = 0.5 + 0.05 * Math.min(signs, 3) + 0.02 * Math.min(level - WEAK_LEVEL, 5);
      const where = url !== undefined ? NAME_URL : NAME_HEADER;
      return finish(actionFor(Math.min(confidence, 0.8)), Math.min(confidence, 0.8), `${where}과 일부만 닮음`);
    }
    if (signs > 0) return finish('record', 0.3, '징후는 있으나 규칙 수준이 낮아 패턴과 맞지 않음');

    return finish('record', level >= WEAK_LEVEL ? 0.2 : 0.05, '맞는 패턴 없음');
  } catch {
    // 어떤 입력이 와도 던지지 않고 기록으로 돌려줍니다.
    return finish('record', 0, '경보를 읽을 수 없어 기록만 남김');
  }
}
