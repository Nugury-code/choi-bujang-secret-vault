import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { clientIp, createMemoryLimiter, durableHit, hashKey, tooMany } from './rate-limit.mjs';
import { createLoginVerifier } from './verify-login.mjs';
import { resourceIdFor, STUDENT_NOTE } from './resources.mjs';

// 가상 메모 추가·조회·수정·삭제를 하는 서버 쪽 공통 코드입니다.
// - 로그인 토큰은 틀이 준 src/verify-login.mjs(도우미)로만 검사합니다. 도우미는 고치지 않습니다.
// - 사용자 ID는 도우미가 확인한 값만 씁니다. 주소·쿼리·본문·헤더의 userId·owner_id·role은 믿지 않습니다.
// - 소유자 검사(4단계): 모든 읽기·수정·삭제는 "note_id가 같고 owner_id가 확인된 사용자 ID와 같은" 행에만 닿습니다.
//   조건을 SQL 한 문장 안에 넣어서(확인 뒤 실행하는 두 단계가 아니라) 그 사이에 주인이 바뀌어도 남의 행은 건드리지 못하고,
//   돌아온 행의 owner_id도 코드에서 한 번 더 비교합니다. 남의 메모와 없는 메모는 같은 404로 답해 존재 여부를 알려 주지 않습니다.
// - SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고, 키·토큰·메모 내용은 로그에 남기지 않습니다.
// 8단계: 권한은 확인된 사용자 ID와 DB에 저장된 owner_id를 다시 대조해서만 정합니다. 화면 메뉴, 요청 본문·헤더·토큰 안의 role은 읽지 않으며
//   이 API에는 강사 권한을 저장해 둔 곳이 없어 강사로 취급되는 사용자도 없습니다(강사 공지 API 없음).
// 아직 남은 일: 이 소유자 검사는 서버 코드에만 있습니다. DB 쪽 권한(GRANT·RLS)으로 한 번 더 막는 일은 다음 요청에서 합니다.

export const TITLE_MAX = 120;
export const BODY_MAX = 5000;
// 요청 횟수 제한(5단계 보강). 창은 초 단위입니다.
// - 같은 IP에서 오는 메모 API 요청(로그인 토큰 검사 전): 인스턴스 메모리에서 셉니다. 로그인 없는 폭주를 일찍 끊습니다.
// - 로그인한 사용자의 쓰기(추가·수정·삭제): 사용자별로 메모리와 DB(rate_limit_hit)에서 셉니다.
export const NOTES_LIMITS = {
  ip: { limit: 300, window: 60 },
  userWrite: { limit: 60, window: 60 },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COLUMNS = 'note_id, title, content, owner_id';
// 본문에 이 이름이 있어도 값으로 쓰지 않습니다. 수정 요청에서 다른 사람 ID가 적혀 있으면 소유자 변경 시도로 보고 거부합니다.
const OWNER_KEYS = ['owner_id', 'ownerId', 'user_id', 'userId'];
const toNote = (row) => ({ id: row.note_id, title: row.title, body: row.content });

function send(response, status, body) {
  return response.status(status).json(body);
}

// 8단계: 거부한 이유를 짧은 이름 하나로만 서버 로그에 남깁니다. 사용자 ID·메모 ID·토큰·메모 내용은 남기지 않습니다.
// 응답은 그대로 두어 남의 메모와 없는 메모를 구별해 알려 주지 않습니다.
function deny(response, status, body, reason) {
  console.error(`notes: denied ${reason}`);
  return send(response, status, body);
}

// Vercel이 JSON 본문을 이미 객체로 풀어 줄 때도, 문자열로 줄 때도 받습니다. 일반 객체가 아니면 null.
function parseBody(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

// 제목·본문만 읽습니다. 다른 이름(owner_id, userId, role …)은 있어도 무시합니다.
function readNoteFields(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = body?.body;
  if (!title || title.length > TITLE_MAX) return null;
  if (typeof text !== 'string' || text.length > BODY_MAX) return null;
  return { title, content: text };
}

// /api/notes/<id> 의 <id>. 주소의 실제 마지막 조각을 우선하고, 없으면 Vercel이 준 경로 값을 씁니다.
function idFromRequest(request) {
  if (typeof request.url === 'string') {
    try {
      const parts = new URL(request.url, 'http://local.invalid').pathname.split('/').filter(Boolean);
      if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'notes') return decodeURIComponent(parts[2]);
    } catch { /* 아래 값으로 넘어갑니다. */ }
  }
  const value = request.query?.id;
  return typeof value === 'string' ? value : '';
}

// /api/notes/<id>/restore 의 <id>. 주소의 실제 조각을 우선하고, 없으면 Vercel이 준 경로 값을 씁니다.
function restoreIdFromRequest(request) {
  if (typeof request.url === 'string') {
    try {
      const parts = new URL(request.url, 'http://local.invalid').pathname.split('/').filter(Boolean);
      if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'notes' && parts[3] === 'restore') return decodeURIComponent(parts[2]);
    } catch { /* 아래 값으로 넘어갑니다. */ }
  }
  const value = request.query?.id;
  return typeof value === 'string' ? value : '';
}

const defaultCreateDb = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// createDb는 시험에서 가짜 DB를 끼우기 위한 자리입니다. 실제 서버는 기본값(Supabase 공식 SDK)을 씁니다.
export function createNotesService({ loginConfig = config, verifierOptions = {}, createDb = defaultCreateDb, memory = createMemoryLimiter() } = {}) {
  let cached = null;
  function verifierFor(secretKey) {
    if (!cached || cached.secretKey !== secretKey) {
      cached = {
        secretKey,
        verify: createLoginVerifier({ config: loginConfig, supabaseSecretKey: secretKey, ...verifierOptions }),
      };
    }
    return cached.verify;
  }

  // 공통 순서: 메서드 → 서버 설정 → IP별 횟수 제한 → 로그인 토큰 → (쓰기는) 사용자별 횟수 제한 → (통과한 뒤에만) 값 검사와 DB.
  async function run(request, response, allowed, work) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    if (!allowed.includes(request.method)) {
      response.setHeader('Allow', allowed.join(', '));
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    // 8단계: 이 코드는 학생 메모(student.note)만 다룹니다. 주소가 다른 자원(예: 강사 공지)으로 확인되면 메모 코드가 대신 답하지 않습니다.
    // 주소가 어느 자원에도 맞지 않거나 없으면(시험에서 주소 없이 부르는 경우) 이 코드의 자원인 메모로 봅니다.
    const requested = typeof request.url === 'string' ? resourceIdFor(request.url) : null;
    if (requested !== null && requested !== STUDENT_NOTE) return deny(response, 404, { error: 'NOT_FOUND' }, 'other_resource');
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error('notes: server settings missing');
      return send(response, 500, { error: 'SERVER_NOT_CONFIGURED' });
    }
    const ipLimit = memory(`notes:ip:${hashKey(key, 'notes-ip', clientIp(request))}`,
      NOTES_LIMITS.ip.limit, NOTES_LIMITS.ip.window * 1000);
    if (!ipLimit.allowed) return tooMany(response, ipLimit.retryAfter);
    let verify;
    try {
      verify = verifierFor(key);
    } catch (error) {
      console.error('notes: login check unavailable', error?.message ?? 'unknown');
      return send(response, 500, { error: 'LOGIN_CHECK_UNAVAILABLE' });
    }
    const identity = await verify(request.headers?.authorization);
    if (!identity) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return send(response, 401, { error: 'UNAUTHORIZED' });
    }
    try {
      const db = createDb(url, key);
      if (request.method !== 'GET') {
        const name = hashKey(key, 'notes-write', identity.userId);
        const rule = NOTES_LIMITS.userWrite;
        let blocked = memory(`notes:write:${name}`, rule.limit, rule.window * 1000);
        if (blocked.allowed) {
          const shared = await durableHit(db, name, rule.limit, rule.window);
          blocked = shared && !shared.allowed ? shared : null;
        }
        if (blocked) return tooMany(response, blocked.retryAfter);
      }
      return await work({ db, userId: identity.userId });
    } catch {
      console.error('notes: unexpected failure');
      return send(response, 500, { error: 'NOTES_UNEXPECTED_FAILURE' });
    }
  }

  function failed(response, error, label) {
    console.error(`notes: ${label} failed`, error.code ?? 'unknown');
    return send(response, 502, { error: label === 'read' ? 'NOTES_READ_FAILED' : 'NOTES_WRITE_FAILED' });
  }

  // /api/notes : GET(목록), POST(추가)
  async function handleCollection(request, response) {
    return run(request, response, ['GET', 'POST'], async ({ db, userId }) => {
      if (request.method === 'GET') {
        // 내 메모만 돌려줍니다. 주인이 없거나 다른 사람 것인 메모는 목록에 나오지 않습니다.
        const { data, error } = await db.from('vault_notes').select(COLUMNS)
          .eq('owner_id', userId).order('id');
        if (error) return failed(response, error, 'read');
        const mine = data.filter((row) => row.owner_id === userId);
        if (mine.length !== data.length) console.error('notes: denied owner_mismatch');
        return send(response, 200, mine.map(toNote));
      }
      const body = parseBody(request);
      const fields = readNoteFields(body);
      if (!fields) return send(response, 400, { error: 'INVALID_NOTE' });
      let id = randomUUID();
      if (body.id !== undefined && body.id !== null) {
        if (typeof body.id !== 'string' || !UUID.test(body.id)) return send(response, 400, { error: 'INVALID_ID' });
        id = body.id.toLowerCase();
      }
      const { error } = await db.from('vault_notes').insert({ note_id: id, owner_id: userId, ...fields });
      if (error) {
        if (error.code === '23505') return send(response, 409, { error: 'ID_ALREADY_EXISTS' });
        return failed(response, error, 'write');
      }
      return send(response, 201, { id });
    });
  }

  // /api/notes/:id : GET(한 건), PUT(수정), DELETE(삭제). 모두 내 메모에만 동작합니다.
  async function handleItem(request, response) {
    return run(request, response, ['GET', 'PUT', 'DELETE'], async ({ db, userId }) => {
      const rawId = idFromRequest(request);
      // 모양이 UUID가 아닌 id는 DB를 부르지 않고 없는 메모로 취급합니다.
      if (!UUID.test(rawId)) return deny(response, 404, { error: 'NOT_FOUND' }, 'bad_id');
      const id = rawId.toLowerCase();
      // 남의 메모와 없는 메모는 같은 404입니다. 행은 왔는데 주인이 다르면 owner_mismatch, 행이 없으면 not_owner_or_missing으로 남깁니다.
      const notFound = (row) => deny(response, 404, { error: 'NOT_FOUND' }, row ? 'owner_mismatch' : 'not_owner_or_missing');
      if (request.method === 'GET') {
        const { data, error } = await db.from('vault_notes').select(COLUMNS)
          .eq('note_id', id).eq('owner_id', userId).maybeSingle();
        if (error) return failed(response, error, 'read');
        // 조건에 맞는 행이 와도 owner_id를 한 번 더 비교합니다.
        return data && data.owner_id === userId ? send(response, 200, toNote(data)) : notFound(data);
      }
      if (request.method === 'PUT') {
        const body = parseBody(request);
        // 소유자 변경 시도: 본문에 확인된 사용자가 아닌 ID가 적혀 있으면 DB를 부르기 전에 거부합니다.
        if (body && OWNER_KEYS.some((key) => key in body && body[key] !== userId)) {
          return deny(response, 403, { error: 'OWNER_CHANGE_NOT_ALLOWED' }, 'owner_change');
        }
        const fields = readNoteFields(body);
        if (!fields) return send(response, 400, { error: 'INVALID_NOTE' });
        // 기존 행의 주인이 나여야 하고(where), 새 행의 주인도 나로 고정합니다(set). 한 문장이라 사이에 끼어들 틈이 없습니다.
        const { data, error } = await db.from('vault_notes').update({ ...fields, owner_id: userId })
          .eq('note_id', id).eq('owner_id', userId).select(COLUMNS).maybeSingle();
        if (error) return failed(response, error, 'write');
        return data && data.owner_id === userId ? send(response, 200, toNote(data)) : notFound(data);
      }
      const { data, error } = await db.from('vault_notes').delete()
        .eq('note_id', id).eq('owner_id', userId).select('note_id, owner_id');
      if (error) return failed(response, error, 'write');
      return data?.some((row) => row.owner_id === userId) ? send(response, 200, { id }) : notFound(data?.length ? data[0] : null);
    });
  }


  // 10단계 /api/notes/:id/restore : POST. 비공개 사본 표(vault_notes_backup)에서 "지정한 메모 한 건"만 되살립니다.
  // 확인과 쓰기는 DB 함수 restore_one_note(supabase/005_restore_function.sql) 한 번의 호출 안에서 한 덩어리로 일어납니다.
  // - 사본 읽기·소유자 대조·내용 해시 검증·쓰기·쓴 뒤 다시 읽어 대조·사본 재확인이 모두 이 덩어리 안에 있고, 하나라도 틀리면
  //   덩어리 전체가 취소되어 메모는 한 글자도 바뀌지 않습니다(그래서 "쓴 뒤 되돌리기"가 따로 없습니다).
  // - 대상은 주소의 id 하나뿐입니다. 소유자는 확인된 사용자 ID로만 정합니다. 본문(body)에서는 dryRun이 정확히 true인지만 읽습니다
  //   (owner_id·role 같은 값이 와도 무시). dryRun이 true이면 아무것도 쓰지 않고 복원할 버전·바뀔 항목만 돌려줍니다(원문 없음).
  // - 다른 메모와 사본 표는 건드리지 않습니다. 다른 사람 소유 행은 덮어쓰지 않고(오류로 끝남), 사본이 없거나 주인이 다르면 같은 404입니다.
  async function handleRestore(request, response) {
    return run(request, response, ['POST'], async ({ db, userId }) => {
      const rawId = restoreIdFromRequest(request);
      if (!UUID.test(rawId)) return deny(response, 404, { error: 'NOT_FOUND' }, 'bad_id');
      const id = rawId.toLowerCase();
      const dryRun = parseBody(request)?.dryRun === true;
      const { data, error } = await db.rpc('restore_one_note', { p_note_id: id, p_owner_id: userId, p_dry_run: dryRun });
      if (error) {
        const tag = typeof error.message === 'string' ? error.message.trim() : '';
        if (tag === 'BACKUP_NOT_FOUND') return deny(response, 404, { error: 'NOT_FOUND' }, 'backup_not_found_or_not_owner');
        if (tag === 'BACKUP_INTEGRITY_FAILED') return deny(response, 409, { error: 'BACKUP_INTEGRITY_FAILED' }, 'backup_hash_mismatch');
        if (tag === 'RESTORE_VERIFY_FAILED') return deny(response, 502, { error: 'RESTORE_VERIFY_FAILED' }, 'restore_verify_failed');
        // 같은 id의 행이 다른 소유자로 있으면 덮어쓰지 않습니다.
        if (error.code === '23505') return deny(response, 404, { error: 'NOT_FOUND' }, 'restore_owner_conflict');
        return failed(response, error, 'write');
      }
      // 돌아온 값도 한 번 더 봅니다: 같은 id, 해시 모양, 기대한 종류의 응답일 때만 그대로 전달합니다.
      const sha = dryRun ? data?.backup?.contentSha256 : data?.contentSha256;
      const good = data && typeof data === 'object' && data.id === id && typeof sha === 'string' && /^[0-9a-f]{64}$/u.test(sha)
        && (dryRun ? data.dryRun === true : (data.restored === true && data.ownerId === userId));
      if (!good) return deny(response, 502, { error: 'RESTORE_VERIFY_FAILED' }, 'restore_bad_reply');
      console.log(dryRun ? 'notes: restore preview' : 'notes: restored one note');
      // 복구 응답은 복구된 한 건의 id·소유자·내용 해시(와 restored 표시)만 돌려줍니다. 미리보기는 DB 함수가 준 그대로입니다.
      return send(response, 200, dryRun ? data : { id: data.id, ownerId: data.ownerId, restored: true, contentSha256: data.contentSha256 });
    });
  }

  return { handleCollection, handleItem, handleRestore };
}
