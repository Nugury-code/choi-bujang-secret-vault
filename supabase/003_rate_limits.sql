-- 요청 횟수 제한용 표와 함수 (6단계가 아니라 5단계 보강). 메모 자료는 들어 있지 않습니다.
-- 서버 함수(service_role)만 쓰고, 공개 키(anon)와 로그인 사용자(authenticated)는 표도 함수도 쓰지 못합니다.
-- 키(key)에는 IP·이메일이 아니라 서버 키로 해시한 값만 들어옵니다. 여러 번 실행해도 안전합니다.

create table if not exists public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limits to service_role;

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  window_begin timestamptz;
  window_end   timestamptz;
  total        integer;
begin
  if p_key is null or length(p_key) > 100 or p_window_seconds < 1 or p_window_seconds > 86400 or p_limit < 1 then
    raise exception 'invalid rate limit arguments';
  end if;
  window_begin := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  window_end   := window_begin + make_interval(secs => p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, window_begin, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into total;

  -- 가끔 하루 지난 줄을 지웁니다(표가 계속 커지지 않게).
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  allowed := total <= p_limit;
  retry_after := greatest(1, ceil(extract(epoch from (window_end - now())))::integer);
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
