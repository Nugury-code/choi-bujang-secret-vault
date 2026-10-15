import { createOpsService } from '../../src/ops-service.mjs';

// /api/ops : GET(탈환 작전실 요약, 읽기 전용). 구현은 src/ops-service.mjs에 있습니다.
export function createOpsHandler(options) {
  return createOpsService(options).handleOps;
}

export default createOpsHandler();
