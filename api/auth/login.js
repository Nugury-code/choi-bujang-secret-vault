import { createAuthService } from '../../src/auth-service.mjs';

// /api/auth/login : POST. 규칙은 src/auth-service.mjs에 있습니다.
export function createLoginHandler(options) {
  return createAuthService(options).handleLogin;
}

export default createLoginHandler();
