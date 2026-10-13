-- 10단계: 비공개 사본에서 메모 "한 건"을 되살리는 DB 함수. 확인과 쓰기를 한 덩어리(트랜잭션)로 묶습니다.
-- 한 단계라도 틀리면 오류로 끝나고, 그 덩어리 안에서 한 모든 쓰기는 자동으로 취소됩니다(메모는 한 글자도 바뀌지 않음).
-- 그래서 서버 코드에 "쓴 뒤 되돌리기"가 필요 없고, "검증 실패했는데 복원된 채 남는" 상태도 생기지 않습니다.
-- 이 파일에는 메모 내용도 이메일도 비밀값도 없습니다. Supabase SQL Editor에서 사용자가 직접 실행합니다(여러 번 실행해도 같은 결과).
-- 내용 해시는 서버 코드(src/note-hash.mjs)와 같은 방식입니다: sha256( sha256(제목) 뒤에 sha256(본문) 을 이어 붙인 것 ).
-- digest 함수가 없다는 오류가 나면 아래 search_path 줄의 extensions를 확인하세요(Supabase는 pgcrypto를 extensions 칸에 둡니다).

create or replace function public.restore_one_note(p_note_id uuid, p_owner_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  b public.vault_notes_backup%rowtype;
  b2 public.vault_notes_backup%rowtype;
  l public.vault_notes%rowtype;
  have_live boolean;
  before_sha text;
  will jsonb;
begin
  -- 1) 사본을 읽고 잠급니다(읽는 동안 다른 요청이 사본을 바꾸지 못하게). 없거나 주인이 다르면 같은 오류입니다.
  select * into b from public.vault_notes_backup
    where note_id = p_note_id and owner_id = p_owner_id for share;
  if not found then
    raise exception 'BACKUP_NOT_FOUND';
  end if;

  -- 2) 사본의 내용 해시를 다시 계산해 저장된 해시와 대조합니다. 다르면 아무것도 쓰지 않고 끝냅니다.
  if encode(digest(digest(convert_to(b.title, 'UTF8'), 'sha256') || digest(convert_to(b.content, 'UTF8'), 'sha256'), 'sha256'), 'hex')
     is distinct from b.content_sha256 then
    raise exception 'BACKUP_INTEGRITY_FAILED';
  end if;

  -- 3) 실행 전 모습: 지금 내 메모가 있는지, 사본과 무엇이 다른지(원문은 돌려주지 않습니다).
  select * into l from public.vault_notes where note_id = p_note_id and owner_id = p_owner_id for update;
  have_live := found;
  before_sha := case when have_live then
    encode(digest(digest(convert_to(l.title, 'UTF8'), 'sha256') || digest(convert_to(l.content, 'UTF8'), 'sha256'), 'sha256'), 'hex') end;
  will := jsonb_build_object(
    'recreate', not have_live,
    'title', (not have_live) or l.title is distinct from b.title,
    'content', (not have_live) or l.content is distinct from b.content);

  if p_dry_run then
    return jsonb_build_object(
      'id', p_note_id, 'dryRun', true,
      'backup', jsonb_build_object('contentSha256', b.content_sha256, 'backedUpAt', b.backed_up_at),
      'current', jsonb_build_object('exists', have_live, 'contentSha256', before_sha),
      'willChange', will);
  end if;

  -- 4) 이 메모 한 건만 사본의 내용으로 덮어쓰거나(변조) 같은 id로 다시 만듭니다(삭제). 다른 소유자의 같은 id 행이 있으면 오류로 끝납니다.
  if have_live then
    update public.vault_notes set title = b.title, content = b.content
      where note_id = p_note_id and owner_id = p_owner_id;
  else
    insert into public.vault_notes (note_id, owner_id, title, content)
      values (p_note_id, p_owner_id, b.title, b.content);
  end if;

  -- 5) 쓴 결과를 같은 덩어리 안에서 다시 읽어 id·소유자·내용 해시가 사본과 같은지 확인하고, 사본도 한 번 더 읽어 그대로인지 확인합니다.
  select * into l from public.vault_notes where note_id = p_note_id and owner_id = p_owner_id;
  if not found
     or l.note_id is distinct from p_note_id
     or l.owner_id is distinct from p_owner_id
     or encode(digest(digest(convert_to(l.title, 'UTF8'), 'sha256') || digest(convert_to(l.content, 'UTF8'), 'sha256'), 'sha256'), 'hex')
        is distinct from b.content_sha256 then
    raise exception 'RESTORE_VERIFY_FAILED';
  end if;
  select * into b2 from public.vault_notes_backup where note_id = p_note_id and owner_id = p_owner_id;
  if not found or b2.content_sha256 is distinct from b.content_sha256
     or b2.title is distinct from b.title or b2.content is distinct from b.content then
    raise exception 'BACKUP_INTEGRITY_FAILED';
  end if;

  -- 응답: 최상위에는 "복구된 한 건"의 id·소유자·내용 해시(사본과 같음을 위에서 확인한 값)와 restored 표시만 둡니다.
  -- 카드가 말하는 "버전과 바뀐 항목"은 report 안에 따로 담습니다(사본 버전, 복구 직전 해시, 바뀐 항목). 원문(제목·본문)은 넣지 않습니다.
  return jsonb_build_object(
    'id', l.note_id, 'ownerId', l.owner_id, 'restored', true, 'contentSha256', b.content_sha256,
    'report', jsonb_build_object(
      'backupVersion', jsonb_build_object('contentSha256', b.content_sha256, 'backedUpAt', b.backed_up_at),
      'before', jsonb_build_object('exists', have_live, 'contentSha256', before_sha),
      'changed', will));
end;
$$;

-- 브라우저용 역할(anon, authenticated)과 모두(public)에게는 실행 권한을 주지 않습니다. 서버 전용 역할만 부를 수 있습니다.
revoke all on function public.restore_one_note(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.restore_one_note(uuid, uuid, boolean) to service_role;

-- 확인용(읽기만 합니다): 함수가 있고, 서버 전용 역할만 실행할 수 있어야 합니다.
select
  exists (select 1 from pg_proc where oid = 'public.restore_one_note(uuid, uuid, boolean)'::regprocedure) as function_exists,
  has_function_privilege('service_role', 'public.restore_one_note(uuid, uuid, boolean)', 'execute') as server_can_run,
  has_function_privilege('anon', 'public.restore_one_note(uuid, uuid, boolean)', 'execute') as anon_can_run,
  has_function_privilege('authenticated', 'public.restore_one_note(uuid, uuid, boolean)', 'execute') as authenticated_can_run;
