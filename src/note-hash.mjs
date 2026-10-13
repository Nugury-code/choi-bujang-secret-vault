import { createHash } from 'node:crypto';

// 10단계: 메모 한 건의 "내용 해시". 제목과 본문을 각각 sha256으로 만든 뒤 두 값을 이어 다시 sha256 합니다.
// (제목 끝과 본문 시작의 경계가 헷갈리지 않도록 각각 해시한 뒤 합칩니다.)
// 사본 표(vault_notes_backup)의 content_sha256 칸은 같은 방식으로 SQL에서 만듭니다(supabase/004_notes_backup.sql).
const sha = (value) => createHash('sha256').update(value, 'utf8').digest();

export function noteContentSha256(title, content) {
  if (typeof title !== 'string' || typeof content !== 'string') return null;
  return createHash('sha256').update(Buffer.concat([sha(title), sha(content)])).digest('hex');
}
