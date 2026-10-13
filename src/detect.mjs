// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
//
// 입력 처리(readEvents): 사건에서 정해 둔 값만 꺼내고 나머지는 읽지도 저장하지도 않습니다.
//  - 계약(docs/DETECT_EVENTS.md)에 있는 값: at(시각), method(요청 종류), identity.sub(가명 사용자).
//  - 계약에 없는 값(짐작): 기기(deviceId 등), 판정(decision), 네트워크(network). 있고 모양이 맞을 때만 읽고, 없으면 null입니다.
//    이름은 판정기 계약(signals.network 등)에서 따온 짐작이며, 기기는 몇 가지 흔한 위치만 봅니다.
//  - 지역(region)은 읽지 않습니다. 지역 하나만으로는 어떤 판단도 하지 않습니다.
//  - 모양이 맞지 않는 사건(시각·요청 종류·사용자 값이 없거나 이상함)은 건너뛰고 건너뛴 개수만 셉니다.
//  - 메모 내용, 토큰, 실명, 이메일처럼 보이는 값은 모양 검사에서 걸러져 결과에 들어가지 않습니다. 값은 로그나 오류 메시지에 쓰지 않습니다.
//
// 복합 의심 규칙 하나: 같은 가명 사용자의 GET이 어느 10분 구간에서든 120건을 넘고(문서 규칙, 정확히 120건은 대상 아님),
// 그 구간의 네트워크가 "평소와 같다(usual)"고 분명히 적혀 있지 않을 때 회수 제안을 돌려줍니다.
//  - 네트워크 값이 없거나 읽을 수 없으면 정상(usual)으로 채우지 않고 알 수 없음으로 둡니다. 알 수 없음이면 문서 규칙만으로 제안합니다.
//  - 구간 사건 중에 unusual이 있으면 평소와 다른 네트워크가 함께 나타난 복합 사건입니다.
//  - 다량 조회가 없으면(네트워크·지역만 다르거나 조회가 적음) 의심으로 표시하지 않습니다(observe). 정상 사건은 그대로 둡니다.
//  - 사유 이름은 문서에 있는 burst_read만 씁니다. 새 이름을 만들지 않았습니다.
//
// 회수 제안의 대상: 의심 구간에서 확인된 가상 기기가 정확히 하나일 때만 그 기기를 제안에 deviceId로 붙입니다(unusual 사건에
// 기기가 있으면 그 사건의 기기를 우선합니다). 기기가 없거나 둘 이상이면 붙이지 않고 문서의 세 항목만 돌려줍니다.
//  - 이 파일은 제안(결과)만 돌려줍니다. 회수 API를 부르거나 기기 권한을 바꾸지 않고, 접속 허용/거부 응답(판정기)도 건드리지 않습니다.
//  - 네트워크·기기 필드 이름, 제안의 deviceId 이름, 10분 경계(600초 이하) 처리는 계약에 없는 짐작입니다.
//    실제 회수와 걸린 시간은 심판이 가상 사건으로 확인합니다.
const METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const DECISIONS = Object.freeze(['allow', 'deny', 'step_up']);
const NETWORKS = Object.freeze(['usual', 'unusual']);
const PSEUDONYM = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;
const TRUSTED_SOURCE = 'judge_fixture';
const WINDOW_MS = 10 * 60 * 1000; // 문서: 어느 10분 구간에서든
const BURST_OVER = 120; // 문서: 120건을 넘을 때만 (정확히 120건은 대상이 아님)

function pseudonym(value) {
  if (typeof value !== 'string' || !PSEUDONYM.test(value)) return null;
  // 토큰(JWT)처럼 점으로 나뉜 긴 값은 가명 번호가 아니므로 읽지 않습니다.
  if (value.startsWith('eyJ') || value.split('.').length > 2) return null;
  return value;
}

// 짐작: 사건 바로 아래 network 또는 signals.network. signals에 source가 있으면 심판 가상 입력일 때만 믿습니다.
function networkOf(event) {
  const signals = event.signals;
  if (signals !== null && typeof signals === 'object') {
    if (signals.source !== undefined && signals.source !== TRUSTED_SOURCE) return null;
    if (NETWORKS.includes(signals.network)) return signals.network;
  }
  return NETWORKS.includes(event.network) ? event.network : null;
}

// 짐작: 기기 번호가 있을 만한 흔한 위치 몇 곳(deviceId, identity.deviceId, device 또는 device.id). 없으면 null.
function deviceOf(event) {
  const holder = event.device !== null && typeof event.device === 'object' ? event.device.id : event.device;
  for (const value of [event.deviceId, event.identity?.deviceId, holder]) {
    const found = pseudonym(value);
    if (found !== null) return found;
  }
  return null;
}

function readOne(event) {
  if (event === null || typeof event !== 'object') return null;
  const atMs = typeof event.at === 'string' ? Date.parse(event.at) : Number.NaN;
  const method = typeof event.method === 'string' ? event.method.toUpperCase() : '';
  const sub = pseudonym(event.identity?.sub);
  if (!Number.isFinite(atMs) || !METHODS.includes(method) || sub === null) return null;
  return {
    atMs,
    method,
    sub,
    deviceId: deviceOf(event), // 짐작: 계약에 없는 이름입니다. 없으면 null.
    decision: DECISIONS.includes(event.decision) ? event.decision : null, // 짐작: 계약에 없는 이름입니다. 없으면 null.
    network: networkOf(event), // 짐작: 계약에 없는 이름입니다. 없으면 null(알 수 없음).
  };
}

export function readEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const read = [];
  let skipped = 0;
  for (const event of events) {
    const one = readOne(event);
    if (one === null) skipped += 1;
    else read.push(one);
  }
  return { events: read, skipped };
}

// 구간의 네트워크 판단: unusual이 하나라도 있으면 'unusual', 없고 usual만 있으면 'usual', 값이 없으면 'unknown'.
function networkVerdict(windowEvents) {
  if (windowEvents.some(item => item.network === 'unusual')) return 'unusual';
  return windowEvents.some(item => item.network === 'usual') ? 'usual' : 'unknown';
}

// 한 사용자의 GET 사건(시각 순서)에서 10분 구간 하나라도 120건을 넘고 네트워크가 usual이 아니면
// 처음 찾은 그 구간의 사건 목록을 돌려주고, 없으면 null.
function findCompoundBurst(gets) {
  let start = 0;
  for (let end = 0; end < gets.length; end += 1) {
    while (gets[end].atMs - gets[start].atMs > WINDOW_MS) start += 1;
    if (end - start + 1 <= BURST_OVER) continue;
    const windowEvents = gets.slice(start, end + 1);
    if (networkVerdict(windowEvents) !== 'usual') return windowEvents;
  }
  return null;
}

// 의심 구간에서 확인된 기기가 정확히 하나일 때만 그 기기를 돌려줍니다. unusual 사건의 기기를 먼저 보고, 없으면 구간 전체를 봅니다.
function singleDevice(windowEvents) {
  const pick = items => new Set(items.map(item => item.deviceId).filter(id => id !== null));
  let devices = pick(windowEvents.filter(item => item.network === 'unusual'));
  if (devices.size === 0) devices = pick(windowEvents);
  return devices.size === 1 ? [...devices][0] : null;
}

export function detect(events) {
  const { events: read } = readEvents(events);
  const bySub = new Map();
  for (const item of read) {
    if (item.method !== 'GET') continue;
    if (!bySub.has(item.sub)) bySub.set(item.sub, []);
    bySub.get(item.sub).push(item);
  }
  for (const sub of [...bySub.keys()].sort()) {
    const gets = bySub.get(sub).sort((a, b) => a.atMs - b.atMs);
    const burst = findCompoundBurst(gets);
    if (burst === null) continue;
    const proposal = { action: 'propose_revocation', reasonCode: 'burst_read', subject: sub };
    const deviceId = singleDevice(burst);
    if (deviceId !== null) proposal.deviceId = deviceId;
    return proposal;
  }
  return { action: 'observe' };
}
