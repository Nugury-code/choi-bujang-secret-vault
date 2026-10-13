// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계: 등록된 기기에서 온 자료 읽기(GET)만 허용하고, 미등록이거나 값이 없으면 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다.
// 7단계: readSignals가 가상 접속 정보의 출처와 값을 검사하고, step_up_required 규칙이 그 결과를 씁니다.
// 8단계: zone_rules가 자원(메모, 강사 공지)과 동작을 정확한 경로로 가립니다.
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
// 8단계 구역 규칙(zone_rules): 엔진이 확인한 method와 route(정확한 경로)로만 자원과 동작을 고릅니다.
// - 쿼리(queryLength, querySha256)는 기능을 고르는 데 쓰지 않습니다. 고르는 것은 자료 ID(경로의 :id)뿐입니다.
// - 표에 없는 method·route 조합과 경로 모양이 맞지 않는 요청은 모르는 경로로 보고 거부합니다.
// - :id와 같은 깊이에는 기능 경로(export 같은 이름)를 두지 않고, 그런 이름이 자료 ID 자리에 오면 거부합니다.
// - 강사 공지(instructor.notice) 수정은 계약에 강사 역할 값이 없어서(request.role 없음) 누구에게도 허용하지 않습니다.
// - 요청에는 메모의 주인 정보가 없어서 "자기 메모인지"는 여기서 가릴 수 없습니다. 그 검사는 최종 자료 API(소유자 검사, 남의 메모 404)가 합니다.
const ZONE_ROUTES = Object.freeze({
  'GET /notes': { resource: 'student.note', action: 'read' },
  'GET /notes/:id': { resource: 'student.note', action: 'read' },
  'PUT /notes/:id': { resource: 'student.note', action: 'update' },
  'GET /api/notes': { resource: 'student.note', action: 'read' },
  'GET /api/notes/:id': { resource: 'student.note', action: 'read' },
  'PUT /api/notes/:id': { resource: 'student.note', action: 'update' },
  'PUT /notices/:id': { resource: 'instructor.notice', action: 'update' },
  'PUT /api/notices/:id': { resource: 'instructor.notice', action: 'update' },
});
const RESERVED_IDS = Object.freeze(['export', 'import', 'search', 'list', 'all', 'new', 'admin', 'bulk', 'download']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
function zoneOf(request) {
  const { method, route, path } = request ?? {};
  if (typeof method !== 'string' || typeof route !== 'string' || typeof path !== 'string') return null;
  if (!Object.hasOwn(ZONE_ROUTES, route) || !route.startsWith(`${method} `)) return null;
  if (path.includes('?') || path.includes('#') || !path.startsWith('/')) return null;
  const want = route.slice(method.length + 1).split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  if (want.length !== got.length) return null;
  for (let i = 0; i < want.length; i += 1) {
    if (want[i] === ':id') {
      if (!ID_PATTERN.test(got[i]) || RESERVED_IDS.includes(got[i].toLowerCase())) return null;
    } else if (want[i] !== got[i]) return null;
  }
  return ZONE_ROUTES[route];
}
export async function decide(request) {
  if (request?.deviceRegistered !== true) return respond(request, 'deny', 'device_not_registered', 'device_registered');
  const zone = zoneOf(request);
  if (zone === null) return respond(request, 'deny', 'unknown_route', 'zone_rules');
  if (zone.resource !== 'student.note') return respond(request, 'deny', 'forbidden_resource', 'zone_rules');
  if (request.method === 'GET') {
    if (isUnusualAccess(request) && !recentlyVerified(request)) {
      return respond(request, 'step_up', 'step_up_required', 'step_up_required');
    }
    return respond(request, 'allow', 'approved', 'zone_rules');
  }
  if (zone.action === 'update') return respond(request, 'allow', 'approved', 'zone_rules');
  return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
}
