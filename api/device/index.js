import { createDeviceService } from '../../src/device-service.mjs';

// /api/device : POST(이 기기의 승인 요청과 승인 상태 확인). 로그인 토큰 검사와 규칙은 src/device-service.mjs에 있습니다.
export function createDeviceHandler(options) {
  return createDeviceService(options).handleDevice;
}

export default createDeviceHandler();
