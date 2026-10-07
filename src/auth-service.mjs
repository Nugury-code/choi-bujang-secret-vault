import { createClient } from '@supabase/supabase-js';
import { clientIp, createMemoryLimiter, durableHit, hashKey, tooMany } from './rate-limit.mjs';

// 로그인·토큰 갱신·로그아웃을 서버 함수 한곳으로 모읍니다(5단계).
// - 브라우저는 Supabase 주소·공개 키를 알지 못하고, 이 서버 함수만 부릅니다. 공개 키는 서버 환경변수 SUPABASE_PUBLISHABLE_KEY에서만 읽습니다.
// - 비밀번호는 이 함수가 Supabase Auth로 그대로 전달만 하고 저장·기록하지 않습니다. 확인과 토큰 발급은 Supabase Auth가 합니다.
// - 갱신 토큰(refresh token)은 JavaScript가 읽을 수 없는 쿠키(HttpOnly·Secure·SameSite=Strict, 경로 /api/auth)에만 둡니다.
//   브라우저 화면에는 짧게 사는 접근 토큰(access token)만 내려가고, 화면은 그것을 메모리에만 둡니다.
// - 다른 사이트에서 보낸 요청은 거부하고(Origin 확인), 로그인은 IP별·이메일별로 횟수를 제한합니다.
// - 키·토큰·이메일·비밀번호는 응답 오류 문구와 로그에 남기지 않습니다.

const COOKIE = 'byteback_rt';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const TOKEN = /^[A-Za-z0-9._-]{8,2048}$/u;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/u;

// 제한 값(필요하면 여기서 조정). 창은 초 단위입니다.
export const LIMITS = {
  loginIp: { limit: 20, window: 600 },
  loginEmail: { limit: 8, window: 600 },
  refreshIp: { limit: 120, window: 600 },
  logoutIp: { limit: 60, window: 600 },
};

const defaultCreateDb = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function readCookie(request, name) {
  const raw = request.headers?.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`;
}

function parseBody(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

// 브라우저가 Origin을 보냈다면 이 사이트 자신이어야 합니다(다른 사이트의 페이지가 대신 보내는 요청 차단).
function sameOrigin(request) {
  const origin = request.headers?.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === request.headers?.host; } catch { return false; }
}

export function createAuthService({ createDb = defaultCreateDb, fetchImpl = (...args) => fetch(...args), memory = createMemoryLimiter() } = {}) {
  function settings() {
    const url = process.env.SUPABASE_URL;
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY;
    return url && publishable && secret ? { url: url.replace(/\/+$/u, ''), publishable, secret } : null;
  }

  // 공통 순서: 메서드 → 같은 사이트 → 서버 설정 → (각 처리에서) 횟수 제한 → Supabase Auth.
  async function run(request, response, work) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!sameOrigin(request)) return response.status(403).json({ error: 'CROSS_ORIGIN_NOT_ALLOWED' });
    const env = settings();
    if (!env) {
      console.error('auth: server settings missing');
      return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
    }
    try {
      return await work(env);
    } catch {
      console.error('auth: unexpected failure');
      return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    }
  }

  // 메모리 제한 → DB 제한 순서로 확인하고, 막히면 429로 답할 값을 돌려줍니다.
  async function limited(env, checks, { useDb = true } = {}) {
    for (const [key, rule] of checks) {
      const result = memory(`auth:${key}`, rule.limit, rule.window * 1000);
      if (!result.allowed) return result;
    }
    if (!useDb) return null;
    const db = createDb(env.url, env.secret);
    for (const [key, rule] of checks) {
      const result = await durableHit(db, key, rule.limit, rule.window);
      if (result && !result.allowed) return result;
    }
    return null;
  }

  async function authCall(env, path, { token, body } = {}) {
    const headers = { apikey: env.publishable, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const upstream = await fetchImpl(`${env.url}/auth/v1/${path}`, {
      method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    let data = null;
    try { data = await upstream.json(); } catch { /* 본문이 없거나 JSON이 아닙니다. */ }
    return { status: upstream.status, data };
  }

  // Supabase 세션 응답 → 화면에 내려줄 값. 갱신 토큰은 쿠키로만 보냅니다.
  function sessionResponse(response, data) {
    const access = data?.access_token;
    const refresh = data?.refresh_token;
    if (typeof access !== 'string' || typeof refresh !== 'string' || !TOKEN.test(refresh)) {
      return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    }
    response.setHeader('Set-Cookie', cookieHeader(refresh, COOKIE_MAX_AGE));
    return response.status(200).json({
      access_token: access,
      expires_in: Number.isFinite(data.expires_in) ? data.expires_in : 3600,
      user: { id: typeof data.user?.id === 'string' ? data.user.id : null,
        email: typeof data.user?.email === 'string' ? data.user.email : null },
    });
  }

  function clearCookie(response) {
    response.setHeader('Set-Cookie', cookieHeader('', 0));
  }

  async function handleLogin(request, response) {
    return run(request, response, async (env) => {
      const body = parseBody(request);
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!EMAIL.test(email) || email.length > 254 || !password || password.length > 1024) {
        return response.status(400).json({ error: 'INVALID_REQUEST' });
      }
      const blocked = await limited(env, [
        [hashKey(env.secret, 'login-ip', clientIp(request)), LIMITS.loginIp],
        [hashKey(env.secret, 'login-email', email.toLowerCase()), LIMITS.loginEmail],
      ]);
      if (blocked) return tooMany(response, blocked.retryAfter);
      const result = await authCall(env, 'token?grant_type=password', { body: { email, password } });
      if (result.status === 200) return sessionResponse(response, result.data);
      const code = result.data?.error_code ?? result.data?.code ?? '';
      if (result.status === 429 || code === 'over_request_rate_limit') return tooMany(response, 60);
      if (code === 'email_not_confirmed') return response.status(401).json({ error: 'EMAIL_NOT_CONFIRMED' });
      if (code === 'user_banned') return response.status(401).json({ error: 'ACCOUNT_BLOCKED' });
      if (result.status === 400 || result.status === 401 || result.status === 422) {
        return response.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }
      console.error('auth: login upstream failed', result.status);
      return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    });
  }

  async function handleRefresh(request, response) {
    return run(request, response, async (env) => {
      const refresh = readCookie(request, COOKIE);
      const hasSession = Boolean(refresh && TOKEN.test(refresh));
      // 로그인 쿠키가 없는 방문(처음 여는 화면)은 DB를 부르지 않고 메모리 제한만 합니다.
      const blocked = await limited(env, [
        [hashKey(env.secret, 'refresh-ip', clientIp(request)), LIMITS.refreshIp],
      ], { useDb: hasSession });
      if (blocked) return tooMany(response, blocked.retryAfter);
      if (!hasSession) return response.status(401).json({ error: 'NO_SESSION' });
      const result = await authCall(env, 'token?grant_type=refresh_token', { body: { refresh_token: refresh } });
      if (result.status === 200) return sessionResponse(response, result.data);
      if (result.status === 429) return tooMany(response, 60);
      if (result.status === 400 || result.status === 401 || result.status === 403) {
        clearCookie(response);
        return response.status(401).json({ error: 'NO_SESSION' });
      }
      console.error('auth: refresh upstream failed', result.status);
      return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    });
  }

  async function handleLogout(request, response) {
    return run(request, response, async (env) => {
      const blocked = await limited(env, [
        [hashKey(env.secret, 'logout-ip', clientIp(request)), LIMITS.logoutIp],
      ]);
      if (blocked) return tooMany(response, blocked.retryAfter);
      // 접근 토큰이 만료됐을 수 있어, 없으면 쿠키의 갱신 토큰으로 새 접근 토큰을 받아 세션을 끝냅니다(실패해도 쿠키는 지웁니다).
      let access = /^Bearer ([A-Za-z0-9._-]+)$/u.exec(request.headers?.authorization ?? '')?.[1] ?? null;
      try {
        const refresh = readCookie(request, COOKIE);
        if (!access && refresh && TOKEN.test(refresh)) {
          const renewed = await authCall(env, 'token?grant_type=refresh_token', { body: { refresh_token: refresh } });
          if (renewed.status === 200 && typeof renewed.data?.access_token === 'string') access = renewed.data.access_token;
        }
        if (access) await authCall(env, 'logout?scope=local', { token: access });
      } catch {
        console.error('auth: logout upstream unavailable');
      }
      clearCookie(response);
      return response.status(200).json({ ok: true });
    });
  }

  return { handleLogin, handleRefresh, handleLogout };
}
