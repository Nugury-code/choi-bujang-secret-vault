import { createNotesService } from '../../../src/notes-service.mjs';

// /api/notes/:id/restore : POST(먼저 미리보기와 확인 코드만 돌려주고, 확인 코드를 붙여 다시 보내면 비공개 사본에서 메모 한 건 복원)와 GET(같은 미리보기만). 로그인 토큰 검사와 규칙은 src/notes-service.mjs에 있습니다.
export function createNoteRestoreHandler(options) {
  return createNotesService(options).handleRestore;
}

export default createNoteRestoreHandler();
