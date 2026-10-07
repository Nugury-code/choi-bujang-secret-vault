import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';

// 가상 메모 추가·조회·수정·삭제를 하는 서버 쪽 공통 코드입니다.
// - 로그인 토큰은 틀이 준 src/verify-login.mjs(도우미)로만 검사합니다. 도우미는 고치지 않습니다.
// - 사용자 ID는 도우미가 확인한 값만 씁니다. 브라우저가 보낸 userId·owner_id·role은 읽지 않습니다.
// - SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고, 키·토큰·메모 내용은 로그에 남기지 않습니다.
// 아직 남은 약점(4단계에서 고칩니다): 소유자 검사가 없어서 로그인한 누구든 id만 알면 남의 메모를
// 읽고 고치고 지울 수 있습니다. 서버가 확인한 사용자 ID는 추가할 때 owner_id로 저장하기만 합니다.

export const TITLE_MAX = 120;
export const BODY_MAX = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COLUMNS = 'note_id, title, content';
const toNote = (row) => ({ id: row.note_id, title: row.title, body: row.content });

function send(response, status, body) {
  return response.status(status).json(body);
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

const defaultCreateDb = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// createDb는 시험에서 가짜 DB를 끼우기 위한 자리입니다. 실제 서버는 기본값(Supabase 공식 SDK)을 씁니다.
export function createNotesService({ loginConfig = config, verifierOptions = {}, createDb = defaultCreateDb } = {}) {
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

  // 공통 순서: 메서드 → 서버 설정 → 로그인 토큰 → (통과한 뒤에만) 값 검사와 DB.
  async function run(request, response, allowed, work) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    if (!allowed.includes(request.method)) {
      response.setHeader('Allow', allowed.join(', '));
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error('notes: server settings missing');
      return send(response, 500, { error: 'SERVER_NOT_CONFIGURED' });
    }
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
        // 내가 추가한 메모와, 주인이 없는 처음 가상 메모(owner_id 없음)를 돌려줍니다. 다른 사람의 메모는 목록에서 뺍니다.
        const { data, error } = await db.from('vault_notes').select(COLUMNS)
          .or(`owner_id.eq.${userId},owner_id.is.null`).order('id');
        if (error) return failed(response, error, 'read');
        return send(response, 200, data.map(toNote));
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

  // /api/notes/:id : GET(한 건), PUT(수정), DELETE(삭제)
  async function handleItem(request, response) {
    return run(request, response, ['GET', 'PUT', 'DELETE'], async ({ db }) => {
      const rawId = idFromRequest(request);
      // 모양이 UUID가 아닌 id는 DB를 부르지 않고 없는 메모로 취급합니다.
      if (!UUID.test(rawId)) return send(response, 404, { error: 'NOT_FOUND' });
      const id = rawId.toLowerCase();
      if (request.method === 'GET') {
        const { data, error } = await db.from('vault_notes').select(COLUMNS).eq('note_id', id).maybeSingle();
        if (error) return failed(response, error, 'read');
        return data ? send(response, 200, toNote(data)) : send(response, 404, { error: 'NOT_FOUND' });
      }
      if (request.method === 'PUT') {
        const fields = readNoteFields(parseBody(request));
        if (!fields) return send(response, 400, { error: 'INVALID_NOTE' });
        const { data, error } = await db.from('vault_notes').update(fields)
          .eq('note_id', id).select(COLUMNS).maybeSingle();
        if (error) return failed(response, error, 'write');
        return data ? send(response, 200, toNote(data)) : send(response, 404, { error: 'NOT_FOUND' });
      }
      const { data, error } = await db.from('vault_notes').delete().eq('note_id', id).select('note_id');
      if (error) return failed(response, error, 'write');
      return data?.length ? send(response, 200, { id }) : send(response, 404, { error: 'NOT_FOUND' });
    });
  }

  return { handleCollection, handleItem };
}
