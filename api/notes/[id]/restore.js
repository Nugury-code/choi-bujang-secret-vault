import { createNotesService } from '../../../src/notes-service.mjs';

// /api/notes/:id/restore : GET(복원 전 미리보기: 복원할 버전과 바뀔 항목)과 POST(비공개 사본에서 메모 한 건 복원). 로그인 토큰 검사와 규칙은 src/notes-service.mjs에 있습니다.
export function createNoteRestoreHandler(options) {
  return createNotesService(options).handleRestore;
}

export default createNoteRestoreHandler();
