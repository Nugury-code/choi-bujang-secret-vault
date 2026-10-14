-- 11단계: 기기 승인 요청 표. 로그인한 사용자가 "이 기기를 승인해 달라"고 보낸 요청이 한 줄씩 쌓입니다.
-- 요청은 항상 'pending'(대기)으로 들어갑니다. 'approved'(승인)로 바꾸는 일은 주인이 이 SQL Editor에서 직접 합니다.
-- 서버 전용 역할(service_role)은 줄을 읽고 새 요청을 추가할 수 있지만 status 칸은 정할 수 없고 고치거나 지울 수 없습니다.
-- 브라우저용 역할(anon, authenticated)은 아무 권한이 없습니다. 이 표에는 공개 키(자물쇠 쪽)만 있고 기기 개인 키는 없습니다.
-- Supabase SQL Editor에서 사용자가 직접 실행합니다. 여러 번 실행해도 같은 결과입니다. (표·칸 이름은 내가 정한 값: 짐작)

create table if not exists public.device_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  owner_id     uuid not null,
  fingerprint  text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  public_key   text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  unique (owner_id, fingerprint)
);

alter table public.device_requests enable row level security;
revoke all on table public.device_requests from public, anon, authenticated;
revoke all on table public.device_requests from service_role;
grant select on table public.device_requests to service_role;
grant insert (owner_id, fingerprint, public_key) on table public.device_requests to service_role;
do $$ begin
  if exists (select 1 from pg_class where relname = 'device_requests_id_seq' and relkind = 'S') then
    execute 'grant usage on sequence public.device_requests_id_seq to service_role';
  end if;
end $$;

-- 승인하는 방법(주인이 직접, 이 SQL Editor에서): 아래 두 줄 중 알맞은 것을 id 번호만 바꿔 실행합니다.
--   select id, created_at, owner_id, left(fingerprint, 12) as fingerprint, status from public.device_requests order by id desc;
--   update public.device_requests set status = 'approved' where id = 1;
-- 거부하려면 'rejected'로 바꿉니다.

-- 확인용(읽기만 합니다): 서버 전용 역할은 읽기와 새 요청 추가만, status 지정·고치기·지우기는 안 되어야 합니다.
select
  (select count(*) from public.device_requests) as request_rows,
  (select relrowsecurity from pg_class where oid = 'public.device_requests'::regclass) as rls_on,
  has_table_privilege('service_role', 'public.device_requests', 'select') as server_can_select,
  has_column_privilege('service_role', 'public.device_requests', 'fingerprint', 'insert') as server_can_insert_fingerprint,
  has_column_privilege('service_role', 'public.device_requests', 'status', 'insert') as server_can_set_status,
  has_table_privilege('service_role', 'public.device_requests', 'update') as server_can_update,
  has_table_privilege('service_role', 'public.device_requests', 'delete') as server_can_delete,
  has_table_privilege('anon', 'public.device_requests', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.device_requests', 'select') as authenticated_can_select;
