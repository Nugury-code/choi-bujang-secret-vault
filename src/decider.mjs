// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계: 등록된 기기에서 온 자료 읽기(GET)만 허용하고, 미등록이거나 값이 없으면 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다.
// 7단계: readSignals가 가상 접속 정보의 출처와 값을 검사하고, step_up_required 규칙이 그 결과를 씁니다.
// 8단계: zone_rules가 자원(메모, 반 공지·강사 자료)과 동작을 주소·route로 가립니다.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required', 'zone_rules']);

function respond(request, decision, reasonCode, ruleId) {
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision,
    reasonCode,
    ruleIds: [ruleId],
  };
}

// 7단계 입력 검사: 엔진이 넘긴 request.signals·request.recentEvents만 읽습니다.
// 출처(source)가 'judge_fixture'(심판이 보낸 가상 접속 정보)일 때만 값을 믿고,
// 'none'이거나 다른 값이면 출처 불명확으로 보아 값을 비웁니다. 없는 값을 정상값으로 채우지 않습니다.
// 요청에 덧붙은 헤더·위치 같은 다른 이름은 읽지 않습니다. 브라우저가 보낸 값은 계약에 없습니다.
const TRUSTED_SOURCE = 'judge_fixture';
const text = value => (typeof value === 'string' && value.length > 0 && value.length <= 32
  && value !== 'unknown' ? value : null);
const count = value => (Number.isInteger(value) && value >= 0 && value <= 1000000 ? value : null);
export function readSignals(request) {
  const raw = request?.signals;
  const empty = { trusted: false, region: null, network: null, hour: null, events: [], complete: false };
  if (!raw || typeof raw !== 'object' || raw.source !== TRUSTED_SOURCE) return empty;
  const hour = Number.isInteger(raw.hour) && raw.hour >= 0 && raw.hour <= 23 ? raw.hour : null;
  const list = Array.isArray(request.recentEvents) ? request.recentEvents.slice(0, 12) : [];
  const events = list.map(item => ({ kind: text(item?.kind), ageSeconds: count(item?.ageSeconds), count: count(item?.count) }))
    .filter(item => item.kind !== null && item.ageSeconds !== null && item.count !== null);
  const region = text(raw.region);
  const network = text(raw.network);
  return { trusted: true, region, network, hour, events, complete: region !== null && network !== null && hour !== null };
}

// 7단계 규칙 step_up_required (아래 기준 숫자는 문서에 없어서 내가 정한 짐작입니다).
// 세 가지가 모두 겹칠 때만 추가 확인을 요구합니다: 평소와 다른 시각, 처음 보는 네트워크, 갑작스러운 많은 읽기.
// 지역은 이 조건에 넣지 않습니다. 지역 하나만으로는 거부도 추가 확인도 하지 않습니다.
const ODD_HOURS_END = 6; // 0~5시를 평소와 다른 시각으로 봄 (짐작)
const BURST_TOTAL = 10; // 최근 사건 횟수 합이 10 이상이면 갑작스러운 많은 읽기로 봄 (짐작)
function isUnusualAccess(request) {
  const sig = readSignals(request);
  if (!sig.trusted || !sig.complete) return false;
  const oddHour = sig.hour < ODD_HOURS_END;
  const newNetwork = sig.network === 'unusual';
  const burst = sig.events.reduce((sum, item) => sum + item.count, 0) >= BURST_TOTAL;
  return oddHour && newNetwork && burst;
}
function recentlyVerified(request) {
  const s = request?.stepUp;
  return s?.verified === true && Number.isInteger(s.authAgeSeconds) && s.authAgeSeconds >= 0 && s.authAgeSeconds <= 900;
}

// 8단계 구역 규칙(zone_rules). 요청이 어떤 모양으로 와도 같은 원칙으로 가립니다. (표시 단어 목록은 내 짐작입니다.)
// 1) 주소를 먼저 정리합니다(퍼센트 인코딩 풀기, 소문자, 끝 슬래시 한 개 허용, 앞의 api 한 칸 제외).
//    `..`, `//`, 역슬래시, 공백, 인코딩된 슬래시처럼 이상한 모양은 모르는 경로입니다.
// 2) 주소와 route를 같은 방식으로 읽어 자원(메모/강사 공지)과 깊이(목록/한 건)를 구하고, 둘이 서로 다르면 거부합니다.
// 3) 주소 어디에든 공지·강사 표시(notice, instructor 등)가 있으면 강사 공지 구역입니다. 계약에 강사 역할 값이 없어서 허용하지 않습니다.
// 4) 메모 한 건의 주인 비교는 판정기에 넣지 않습니다(요청 계약에 주인 정보가 없고, 최종 자료 API가 소유자 검사로 막습니다).
// 5) 쿼리는 읽지 않고 자료 ID(경로의 한 칸)만 봅니다. :id와 같은 깊이에 기능 이름(export 등)을 두지 않고, 그런 값이 오면 거부합니다.
// 6) 허용하는 것은 "메모 한 건 읽기(GET)·수정(PUT)"뿐입니다. 목록·추가·삭제·나머지는 모르는 경로입니다.
// 심판 안내(8단계): 반 공지·강사 자료 쓰기(POST·PUT·PATCH·DELETE)와 메모 전체 목록처럼 여러 사람의 자료를 한꺼번에 여는 경로는 거부합니다.
const NOTICE_MARK = /^(notice|announcement|bulletin|instructor|teacher|staff|admin|class|course|lecture|material|syllabus|assignment|grade)/u;
const RESERVED_IDS = Object.freeze(['export', 'import', 'search', 'list', 'all', 'new', 'bulk', 'download']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const RESTORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BAD_PATH_CHARS = /[?#\\\s\u0000-\u001f]/u;
const BAD_PIECE_CHARS = /[/\\\s?#\u0000-\u001f]/u;

function tokensOf(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || BAD_PATH_CHARS.test(path)) return null;
  const raw = path.split('/').slice(1);
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const out = [];
  for (const piece of raw) {
    let decoded;
    try { decoded = decodeURIComponent(piece).toLowerCase(); } catch { return null; }
    if (decoded === '' || decoded === '.' || decoded === '..' || BAD_PIECE_CHARS.test(decoded)) return null;
    out.push(decoded);
  }
  if (out[0] === 'api') out.shift();
  return out.length ? out : null;
}
function readShape(tokens) {
  if (!tokens) return null;
  if (tokens.some(token => NOTICE_MARK.test(token))) return { resource: 'instructor.notice', depth: tokens.length, id: null };
  // 10단계: 사본에서 한 건을 되돌리는 경로 notes/:id/restore 한 가지만 세 칸 모양으로 인정합니다.
  if (tokens[0] === 'notes' && tokens.length === 3 && tokens[2] === 'restore') {
    return { resource: 'student.note', depth: 3, id: tokens[1], restore: true };
  }
  if (tokens[0] !== 'notes' || tokens.length > 2) return null;
  return { resource: 'student.note', depth: tokens.length, id: tokens[1] ?? null };
}
function zoneOf(request) {
  const { method, route, path } = request ?? {};
  if (typeof method !== 'string' || typeof route !== 'string' || !route.startsWith(`${method} `)) return null;
  const pathTokens = tokensOf(path);
  const routeTokens = tokensOf(route.slice(method.length + 1).replace(/:id/gu, 'routeid'));
  const byPath = readShape(pathTokens);
  const byRoute = readShape(routeTokens);
  if (!byPath || !byRoute) return null;
  // 주소와 route가 말하는 자원·깊이가 서로 다르면 어느 쪽도 믿지 않습니다.
  if (byPath.resource !== byRoute.resource || byPath.depth !== byRoute.depth || Boolean(byPath.restore) !== Boolean(byRoute.restore)) return null;
  if (byPath.resource === 'instructor.notice') return { resource: 'instructor.notice', action: 'update' };
  if (byPath.restore) {
    // 복구는 자료를 덮어쓰는 쓰기라서 POST 한 가지, UUID 한 건만 인정합니다(목록·여러 건·다른 동작은 모르는 경로).
    return request.method === 'POST' && RESTORE_ID.test(byPath.id) ? { resource: 'student.note', action: 'restore' } : null;
  }
  if (byPath.depth !== 2) return { resource: 'student.note', action: 'list' };
  const id = byPath.id;
  if (!ID_PATTERN.test(id) || RESERVED_IDS.includes(id)) return null;
  if (request.method === 'GET') return { resource: 'student.note', action: 'read' };
  if (request.method === 'PUT') return { resource: 'student.note', action: 'update' };
  return null;
}

export async function decide(request) {
  if (request?.deviceRegistered !== true) return respond(request, 'deny', 'device_not_registered', 'device_registered');
  const zone = zoneOf(request);
  if (zone === null) return respond(request, 'deny', 'unknown_route', 'zone_rules');
  if (zone.resource !== 'student.note') return respond(request, 'deny', 'forbidden_resource', 'zone_rules');
  if (zone.action === 'list') return respond(request, 'deny', 'unknown_route', 'zone_rules');
  if (request.method === 'GET') {
    if (isUnusualAccess(request) && !recentlyVerified(request)) {
      return respond(request, 'step_up', 'step_up_required', 'step_up_required');
    }
    return respond(request, 'allow', 'approved', 'zone_rules');
  }
  if (zone.action === 'update') return respond(request, 'allow', 'approved', 'zone_rules');
  // 10단계: 복구는 최근에 본인 확인(step_up)을 마친 요청만 허용하고, 아니면 추가 확인을 요구합니다(기준 시간은 7단계와 같은 짐작값).
  if (zone.action === 'restore') {
    return recentlyVerified(request)
      ? respond(request, 'allow', 'approved', 'zone_rules')
      : respond(request, 'step_up', 'step_up_required', 'step_up_required');
  }
  return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
}
