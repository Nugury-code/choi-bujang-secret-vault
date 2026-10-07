import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

// 서버 함수: 로그인한 요청에만 학습용 DB(vault_notes)의 가상 메모를 돌려줍니다.
// 로그인 토큰은 틀이 준 src/verify-login.mjs(도우미)로만 검사합니다. 도우미가 검사를 통과시킨 요청만
// 믿고, 브라우저가 보낸 userId·role·쿼리·본문 값은 읽지도 않습니다.
// SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고, 키와 토큰은
// 응답·로그·브라우저 파일에 넣지 않습니다.
// 아직 남은 약점: 로그인만 하면 누구든 모든 메모를 받습니다(내 자료만 보이게 하는 일은 4단계).
export function createNotesHandler({ loginConfig = config, verifierOptions = {} } = {}) {
  let cached = null;
  // 도우미는 서버 키가 필요하므로 첫 요청 때 한 번 만들어 재사용합니다(키가 바뀌면 다시 만듭니다).
  function verifierFor(secretKey) {
    if (!cached || cached.secretKey !== secretKey) {
      cached = {
        secretKey,
        verify: createLoginVerifier({ config: loginConfig, supabaseSecretKey: secretKey, ...verifierOptions }),
      };
    }
    return cached.verify;
  }

  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error('notes: server settings missing');
      return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
    }

    // 1) 먼저 로그인 토큰을 검사합니다. 실패하면 DB를 건드리지 않고 자료 없이 거부합니다.
    let verify;
    try {
      verify = verifierFor(key);
    } catch (error) {
      console.error('notes: login check unavailable', error?.message ?? 'unknown');
      return response.status(500).json({ error: 'LOGIN_CHECK_UNAVAILABLE' });
    }
    const identity = await verify(request.headers?.authorization);
    if (!identity) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    // 2) 로그인한 요청만 자료를 읽습니다.
    try {
      const db = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await db.from('vault_notes').select('title, content').order('id');
      if (error) {
        console.error('notes: read failed', error.code ?? 'unknown');
        return response.status(502).json({ error: 'NOTES_READ_FAILED' });
      }
      return response.status(200).json({ notes: data });
    } catch {
      console.error('notes: unexpected failure');
      return response.status(500).json({ error: 'NOTES_UNEXPECTED_FAILURE' });
    }
  };
}

export default createNotesHandler();
