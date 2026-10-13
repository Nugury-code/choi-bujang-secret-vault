// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계: 등록된 기기에서 온 자료 읽기(GET)만 허용하고, 미등록이거나 값이 없으면 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 이 파일은 다른 파일을 읽지 않고 혼자 동작합니다.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

function respond(request, decision, reasonCode, ruleId) {
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision,
    reasonCode,
    ruleIds: [ruleId],
  };
}

export async function decide(request) {
  // 기기 등록 규칙: deviceRegistered 가 정확히 true 일 때만 통과합니다.
  // false, 값 없음, true 가 아닌 다른 모양(문자열 'true' 등)은 모두 미등록으로 보고 거부합니다.
  if (request?.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', 'device_registered');
  }
  // 등록된 기기의 자료 읽기(GET)만 허용합니다.
  if (request.method === 'GET') {
    return respond(request, 'allow', 'approved', 'device_registered');
  }
  // 그 밖의 요청은 기존 시작 규칙 그대로 거부합니다.
  return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
}
