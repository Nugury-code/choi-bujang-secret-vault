import { createNotesService } from '../../src/notes-service.mjs';

// /api/notes/:id : GET(한 건), PUT(수정), DELETE(삭제). 로그인 토큰 검사와 규칙은 src/notes-service.mjs에 있습니다.
export function createNoteItemHandler(options) {
  return createNotesService(options).handleItem;
}

export default createNoteItemHandler();
