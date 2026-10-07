import { createAuthService } from '../../src/auth-service.mjs';

// /api/auth/logout : POST. 규칙은 src/auth-service.mjs에 있습니다.
export function createLogoutHandler(options) {
  return createAuthService(options).handleLogout;
}

export default createLogoutHandler();
