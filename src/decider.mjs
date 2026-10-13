// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계: 등록된 기기에서 온 자료 읽기(GET)만 허용하고, 미등록이거나 값이 없으면 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다.
// 7단계: readSignals가 가상 접속 정보의 출처와 값을 검사하고, step_up_required 규칙이 그 결과를 씁니다.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required']);

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
export async function decide(request) {
  if (request?.deviceRegistered !== true) return respond(request, 'deny', 'device_not_registered', 'device_registered');
  if (request.method === 'GET') {
    if (isUnusualAccess(request) && !recentlyVerified(request)) {
      return respond(request, 'step_up', 'step_up_required', 'step_up_required');
    }
    return respond(request, 'allow', 'approved', 'device_registered');
  }
  return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
}
