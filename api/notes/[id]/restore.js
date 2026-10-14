import { createNotesService } from '../../../src/notes-service.mjs';

// /api/notes/:id/restore : POST(비공개 사본에서 메모 한 건 복원, 한 번 불러도 되고 확인 코드를 붙일 수도 있음)와 GET(복원 전 미리보기만). 로그인 토큰 검사와 규칙은 src/notes-service.mjs에 있습니다.
export function createNoteRestoreHandler(options) {
  return createNotesService(options).handleRestore;
}

export default createNoteRestoreHandler();
