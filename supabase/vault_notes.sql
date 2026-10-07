-- 학습용 Supabase 표 구조와 권한 (자료는 넣지 않습니다)
-- 가상 메모 자체는 이 저장소에 두지 않고, SQL Editor에서 따로 넣었습니다.
-- 여러 번 실행해도 같은 결과가 되도록 작성했습니다.

create table if not exists public.vault_notes (
  id bigint generated always as identity primary key,
  owner_id uuid,                       -- 나중에 사용자별 분리에 쓸 칸. auth.users 외래키는 걸지 않습니다.
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- 행 단위 보안(RLS)을 켭니다. 정책을 만들지 않았으므로 일반 키로는 읽을 수 없습니다.
alter table public.vault_notes enable row level security;

-- 브라우저용 역할(anon, authenticated)에는 읽기 권한을 주지 않습니다.
revoke all on table public.vault_notes from anon, authenticated;
revoke all on sequence public.vault_notes_id_seq from anon, authenticated;

-- 서버 함수(api/notes.js, api/notes/[id].js)가 쓰는 서버 전용 역할만 읽고 쓸 수 있습니다.
-- (3단계 제작 3에서 추가·수정·삭제를 붙이면서 insert, update, delete 권한을 더했습니다.)
grant select, insert, update, delete on table public.vault_notes to service_role;

-- 메모마다 바깥에서 쓰는 UUID(note_id) 칸은 supabase/002_note_id.sql로 더합니다.
