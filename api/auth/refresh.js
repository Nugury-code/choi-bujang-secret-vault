import { createAuthService } from '../../src/auth-service.mjs';

// /api/auth/refresh : POST. 규칙은 src/auth-service.mjs에 있습니다.
export function createRefreshHandler(options) {
  return createAuthService(options).handleRefresh;
}

export default createRefreshHandler();
