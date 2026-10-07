import { createNotesService } from '../src/notes-service.mjs';

// /api/notes : GET(내 메모 목록), POST(메모 추가). 로그인 토큰 검사와 규칙은 src/notes-service.mjs에 있습니다.
export function createNotesHandler(options) {
  return createNotesService(options).handleCollection;
}

export default createNotesHandler();
