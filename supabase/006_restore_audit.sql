-- 10단계: 복원 요청의 감사 기록 표. 복원 경로(POST)가 끝날 때마다 "누가·어느 메모에·어떻게 끝났는지"를 한 줄씩 덧붙입니다.
-- 이 표에는 메모 제목·본문, 이메일, 로그인 토큰, 비밀값이 들어가지 않습니다.
-- 서버 전용 역할(service_role)은 줄을 추가하고 읽기만 할 수 있습니다(고치거나 지울 수 없음). 브라우저용 역할은 아무 권한이 없습니다.
-- Supabase SQL Editor에서 사용자가 직접 실행합니다. 여러 번 실행해도 같은 결과입니다. (표·칸 이름은 내가 정한 값: 짐작)

create table if not exists public.restore_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  owner_id  uuid,
  note_id   uuid,
  outcome   text not null,
  status    integer not null
);

alter table public.restore_audit enable row level security;
revoke all on table public.restore_audit from public, anon, authenticated;
grant select, insert on table public.restore_audit to service_role;
do $$ begin
  if exists (select 1 from pg_class where relname = 'restore_audit_id_seq' and relkind = 'S') then
    execute 'grant usage on sequence public.restore_audit_id_seq to service_role';
  end if;
end $$;

-- 확인용(읽기만 합니다): 줄 수와 권한. 서버 전용 역할만 줄을 추가·읽고, 고치기·지우기는 안 되어야 합니다.
select
  (select count(*) from public.restore_audit) as audit_rows,
  (select relrowsecurity from pg_class where oid = 'public.restore_audit'::regclass) as rls_on,
  has_table_privilege('service_role', 'public.restore_audit', 'insert') as server_can_insert,
  has_table_privilege('service_role', 'public.restore_audit', 'update') as server_can_update,
  has_table_privilege('service_role', 'public.restore_audit', 'delete') as server_can_delete,
  has_table_privilege('anon', 'public.restore_audit', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.restore_audit', 'select') as authenticated_can_select;
