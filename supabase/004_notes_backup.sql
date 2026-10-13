-- 10단계: 비공개 가상 메모 사본 표. 복구 경로(POST /api/notes/:id/restore)가 읽어 가는 "검증한 사본"입니다.
-- 이 파일에는 메모 내용도 이메일도 없습니다. 사본에 넣을 메모는 아래 (2)를 SQL Editor에서 직접 실행해 넣습니다.
-- 여러 번 실행해도 같은 결과가 되도록 작성했습니다. 아직 실행하지 않았습니다(사용자가 SQL Editor에서 실행).

create table if not exists public.vault_notes_backup (
  note_id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  backed_up_at timestamptz not null default now()
);

alter table public.vault_notes_backup enable row level security;

-- 브라우저용 역할(anon, authenticated)에는 아무 권한도 주지 않습니다.
revoke all on table public.vault_notes_backup from anon, authenticated;

-- 서버 전용 역할은 사본을 "읽기만" 합니다. 사본을 서버 코드가 고치거나 지울 수 없게 insert·update·delete는 주지 않습니다.
grant select on table public.vault_notes_backup to service_role;

-- (1) 사본에 넣을 시험 계정 B의 메모 note_id 찾기(읽기만 합니다. 결과의 이메일·내용은 어디에도 붙여넣지 마세요).
--   select n.note_id, u.email
--   from public.vault_notes n join auth.users u on u.id = n.owner_id
--   order by u.email;

-- (2) 위에서 찾은 B 메모의 note_id를 '<B 메모 note_id>' 자리에 넣어 실행합니다(한 건만 넣습니다).
--     내용 해시는 서버 코드(src/note-hash.mjs)와 같은 방식입니다: sha256( sha256(제목) 뒤에 sha256(본문) 을 이어 붙인 것 ).
--     extensions.digest가 없다는 오류가 나면 앞의 "extensions."를 지우고 다시 실행합니다.
--   insert into public.vault_notes_backup (note_id, owner_id, title, content, content_sha256)
--   select n.note_id, n.owner_id, n.title, n.content,
--          encode(extensions.digest(
--            extensions.digest(convert_to(n.title, 'UTF8'), 'sha256') || extensions.digest(convert_to(n.content, 'UTF8'), 'sha256'),
--            'sha256'), 'hex')
--   from public.vault_notes n
--   where n.note_id = '<B 메모 note_id>'
--   on conflict (note_id) do nothing;

-- (3) 확인용(읽기만 합니다): 사본 건수, RLS, 권한. 사본의 내용은 보여 주지 않습니다.
select
  (select count(*) from public.vault_notes_backup) as backup_notes,
  (select relrowsecurity from pg_class where oid = 'public.vault_notes_backup'::regclass) as rls_on,
  has_table_privilege('service_role', 'public.vault_notes_backup', 'select') as server_can_select,
  has_table_privilege('service_role', 'public.vault_notes_backup', 'update') as server_can_update,
  has_table_privilege('service_role', 'public.vault_notes_backup', 'delete') as server_can_delete,
  has_table_privilege('anon', 'public.vault_notes_backup', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.vault_notes_backup', 'select') as authenticated_can_select;
