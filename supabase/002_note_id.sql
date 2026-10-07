-- 3단계 제작 3: 메모마다 바깥(API)에서 쓰는 UUID(note_id)를 둡니다.
-- 기존 id(내부 번호)와 owner_id, RLS·권한 설정은 그대로 두고 칸 하나와 유일 색인만 더합니다.
-- 이미 있는 메모에도 칸이 채워지고, 여러 번 실행해도 안전합니다. Supabase 대시보드의 SQL Editor에서 실행합니다.
alter table public.vault_notes
  add column if not exists note_id uuid not null default gen_random_uuid();

create unique index if not exists vault_notes_note_id_key
  on public.vault_notes (note_id);

-- 확인용(읽기만 합니다): note_id 칸이 uuid이고, 모든 메모의 note_id가 서로 다르며, RLS가 켜져 있어야 합니다.
select
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'vault_notes' and column_name = 'note_id') as note_id_type,
  (select count(*) from public.vault_notes) as notes,
  (select count(distinct note_id) from public.vault_notes) as distinct_note_ids,
  (select relrowsecurity from pg_class where oid = 'public.vault_notes'::regclass) as rls_on;
