import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createAuthService, LIMITS } from '../src/auth-service.mjs';
import { createMemoryLimiter } from '../src/rate-limit.mjs';

const URL_BASE = 'https://example-project.supabase.test';
const PUBLISHABLE = 'sb_publishable_TESTONLYTESTONLYTESTONLY00';
const SECRET = 'fake-secret-for-test-only';
const PASSWORD = 'correct horse battery 9!';
const EMAIL = 'a.user@example.test';
const ACCESS = 'aaaa.bbbb.cccc';
const REFRESH = 'rtok1234567890';
const originalError = console.error;
let logged;
let upstream;

function makeService({ respond, db, memory } = {}) {
  upstream = [];
  const fetchImpl = async (url, init) => {
    const entry = { url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    upstream.push(entry);
    const result = await respond(entry);
    return new Response(JSON.stringify(result.body ?? null), { status: result.status });
  };
  return createAuthService({ fetchImpl, createDb: () => db ?? {}, memory: memory ?? createMemoryLimiter() });
}

async function call(handler, { method = 'POST', headers = {}, body } = {}) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  await handler({ method, headers: { host: 'app.example.test', ...headers }, body }, response);
  return out;
}

const session = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600,
  user: { id: '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10', email: EMAIL, role: 'authenticated', phone: 'x' } } };

beforeEach(() => {
  process.env.SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
});
afterEach(() => {
  console.error = originalError;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
});

const noSecretsLogged = () => {
  const text = logged.join('\n');
  for (const value of [PASSWORD, EMAIL, ACCESS, REFRESH, PUBLISHABLE, SECRET]) assert.ok(!text.includes(value), '로그에 비밀값이 있음');
};

test('로그인 성공: 접근 토큰만 본문으로, 갱신 토큰은 HttpOnly 쿠키로만 내려가고 공개 키는 서버가 붙인다', async () => {
  const service = makeService({ respond: () => session });
  const out = await call(service.handleLogin, { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { access_token: ACCESS, expires_in: 3600,
    user: { id: '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10', email: EMAIL } });
  assert.ok(!JSON.stringify(out.body).includes(REFRESH));
  assert.equal(out.headers.get('cache-control'), 'no-store');
  const cookie = out.headers.get('set-cookie');
  assert.ok(cookie.startsWith(`byteback_rt=${REFRESH};`));
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth', 'Max-Age=604800']) assert.ok(cookie.includes(part), part);
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].url, `${URL_BASE}/auth/v1/token?grant_type=password`);
  assert.equal(upstream[0].headers.apikey, PUBLISHABLE);
  assert.deepEqual(upstream[0].body, { email: EMAIL, password: PASSWORD });
  noSecretsLogged();
});

test('로그인 실패 이유: 틀린 정보·미인증·정지는 구분하되 쿠키는 만들지 않는다', async () => {
  const cases = [
    [{ status: 400, body: { error_code: 'invalid_credentials' } }, 401, 'INVALID_CREDENTIALS'],
    [{ status: 400, body: { error_code: 'email_not_confirmed' } }, 401, 'EMAIL_NOT_CONFIRMED'],
    [{ status: 400, body: { error_code: 'user_banned' } }, 401, 'ACCOUNT_BLOCKED'],
    [{ status: 500, body: {} }, 502, 'AUTH_UNAVAILABLE'],
    [{ status: 200, body: { access_token: ACCESS } }, 502, 'AUTH_UNAVAILABLE'],
  ];
  for (const [reply, status, code] of cases) {
    const out = await call(makeService({ respond: () => reply }).handleLogin, { body: { email: EMAIL, password: PASSWORD } });
    assert.equal(out.status, status, code);
    assert.deepEqual(out.body, { error: code });
    assert.equal(out.headers.has('set-cookie'), false);
  }
  const limited = await call(makeService({ respond: () => ({ status: 429, body: { error_code: 'over_request_rate_limit' } }) }).handleLogin,
    { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: 'RATE_LIMITED' });
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  const broken = await call(createAuthService({ fetchImpl: async () => { throw new Error('network'); }, createDb: () => ({}) }).handleLogin,
    { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(broken.status, 502);
  noSecretsLogged();
});

test('잘못된 입력·메서드·다른 사이트·서버 설정 누락은 Supabase를 부르기 전에 거부한다', async () => {
  const service = makeService({ respond: () => session });
  for (const body of [null, {}, { email: EMAIL }, { password: PASSWORD }, { email: 'no-at-sign', password: PASSWORD },
    { email: EMAIL, password: 'x'.repeat(1025) }, { email: `${'a'.repeat(250)}@example.test`, password: PASSWORD },
    { email: [EMAIL], password: PASSWORD }, [EMAIL, PASSWORD]]) {
    const out = await call(service.handleLogin, { body });
    assert.equal(out.status, 400);
    assert.deepEqual(out.body, { error: 'INVALID_REQUEST' });
  }
  const get = await call(service.handleLogin, { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  const cross = await call(service.handleLogin, { headers: { origin: 'https://evil.example.test' }, body: { email: EMAIL, password: PASSWORD } });
  assert.equal(cross.status, 403);
  assert.deepEqual(cross.body, { error: 'CROSS_ORIGIN_NOT_ALLOWED' });
  const weird = await call(service.handleLogin, { headers: { origin: 'not a url' }, body: { email: EMAIL, password: PASSWORD } });
  assert.equal(weird.status, 403);
  assert.equal(upstream.length, 0);
  const same = await call(service.handleLogin, { headers: { origin: 'https://app.example.test' }, body: { email: EMAIL, password: PASSWORD } });
  assert.equal(same.status, 200);
  const asString = await call(service.handleLogin, { body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  assert.equal(asString.status, 200);
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    const saved = process.env[name];
    delete process.env[name];
    const out = await call(service.handleLogin, { body: { email: EMAIL, password: PASSWORD } });
    assert.equal(out.status, 500, name);
    assert.deepEqual(out.body, { error: 'SERVER_NOT_CONFIGURED' });
    process.env[name] = saved;
  }
});

test('횟수 제한: 같은 이메일 연속 시도, 같은 IP 시도 모두 한도를 넘으면 429이고 Supabase를 더 부르지 않는다', async () => {
  let service = makeService({ respond: () => ({ status: 400, body: { error_code: 'invalid_credentials' } }) });
  const attempt = () => call(service.handleLogin, { headers: { 'x-forwarded-for': '203.0.113.7' }, body: { email: EMAIL, password: 'wrong' } });
  for (let n = 0; n < LIMITS.loginEmail.limit; n += 1) assert.equal((await attempt()).status, 401, `시도 ${n + 1}`);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: 'RATE_LIMITED' });
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(upstream.length, LIMITS.loginEmail.limit);
  // 대소문자만 다른 같은 이메일도 같은 한도를 씁니다.
  const upper = await call(service.handleLogin, { headers: { 'x-forwarded-for': '203.0.113.7' }, body: { email: EMAIL.toUpperCase(), password: 'wrong' } });
  assert.equal(upper.status, 429);

  service = makeService({ respond: () => ({ status: 400, body: { error_code: 'invalid_credentials' } }) });
  for (let n = 0; n < LIMITS.loginIp.limit; n += 1) {
    const out = await call(service.handleLogin, { headers: { 'x-real-ip': '198.51.100.9' }, body: { email: `user${n}@example.test`, password: 'wrong' } });
    assert.equal(out.status, 401, `IP 시도 ${n + 1}`);
  }
  const ipBlocked = await call(service.handleLogin, { headers: { 'x-real-ip': '198.51.100.9' }, body: { email: 'another@example.test', password: 'wrong' } });
  assert.equal(ipBlocked.status, 429);
  const otherIp = await call(service.handleLogin, { headers: { 'x-real-ip': '198.51.100.10' }, body: { email: 'another@example.test', password: 'wrong' } });
  assert.equal(otherIp.status, 401);
});

test('DB 횟수 제한: 모든 인스턴스가 보는 숫자로 막고, 이메일·IP 원본은 DB에 보내지 않으며, DB가 안 되면 메모리 제한만으로 계속한다', async () => {
  const sent = [];
  const blockDb = { rpc: async (name, args) => { sent.push({ name, args }); return { data: [{ allowed: false, retry_after: 42 }], error: null }; } };
  let out = await call(makeService({ respond: () => session, db: blockDb }).handleLogin,
    { headers: { 'x-forwarded-for': '203.0.113.7' }, body: { email: EMAIL, password: PASSWORD } });
  assert.equal(out.status, 429);
  assert.equal(out.headers.get('retry-after'), '42');
  assert.equal(upstream.length, 0);
  assert.ok(sent.length >= 1 && sent.every((call2) => call2.name === 'rate_limit_hit'));
  const text = JSON.stringify(sent);
  assert.ok(!text.includes(EMAIL) && !text.includes('203.0.113.7') && !text.includes(PASSWORD) && !text.includes(SECRET));
  assert.ok(sent.every((call2) => /^[0-9a-f]{40}$/u.test(call2.args.p_key)));

  for (const db of [{ rpc: async () => ({ data: null, error: { code: '42883' } }) }, { rpc: async () => { throw new Error('down'); } }, {}]) {
    out = await call(makeService({ respond: () => session, db }).handleLogin, { body: { email: EMAIL, password: PASSWORD } });
    assert.equal(out.status, 200);
  }
  noSecretsLogged();
});

test('갱신: 쿠키가 없으면 Supabase도 DB도 부르지 않고 401, 있으면 새 토큰과 새 쿠키를 주고, 거절되면 쿠키를 지운다', async () => {
  const rpc = [];
  const db = { rpc: async (...args) => { rpc.push(args); return { data: [{ allowed: true, retry_after: 1 }], error: null }; } };
  let service = makeService({ respond: () => session, db });
  let out = await call(service.handleRefresh, {});
  assert.equal(out.status, 401);
  assert.deepEqual(out.body, { error: 'NO_SESSION' });
  assert.equal(upstream.length, 0);
  assert.equal(rpc.length, 0);
  out = await call(service.handleRefresh, { headers: { cookie: 'other=1; byteback_rt=bad value!!' } });
  assert.equal(out.status, 401);
  assert.equal(upstream.length, 0);

  out = await call(service.handleRefresh, { headers: { cookie: `a=1; byteback_rt=${REFRESH}; b=2` } });
  assert.equal(out.status, 200);
  assert.equal(out.body.access_token, ACCESS);
  assert.ok(!JSON.stringify(out.body).includes(REFRESH));
  assert.ok(out.headers.get('set-cookie').startsWith('byteback_rt=rtok1234567890;'));
  assert.equal(upstream[0].url, `${URL_BASE}/auth/v1/token?grant_type=refresh_token`);
  assert.deepEqual(upstream[0].body, { refresh_token: REFRESH });
  assert.equal(upstream[0].headers.apikey, PUBLISHABLE);
  assert.equal(rpc.length, 1);

  service = makeService({ respond: () => ({ status: 400, body: { error_code: 'refresh_token_not_found' } }) });
  out = await call(service.handleRefresh, { headers: { cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(out.status, 401);
  assert.match(out.headers.get('set-cookie'), /^byteback_rt=; Max-Age=0;/u);
  service = makeService({ respond: () => ({ status: 500, body: {} }) });
  out = await call(service.handleRefresh, { headers: { cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(out.status, 502);
  assert.equal(out.headers.has('set-cookie'), false);
  const cross = await call(service.handleRefresh, { headers: { origin: 'https://evil.example.test', cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(cross.status, 403);
  noSecretsLogged();
});

test('갱신 횟수 제한: 쿠키 없는 방문도 메모리 제한을 넘으면 429', async () => {
  const service = makeService({ respond: () => session });
  let blockedAt = null;
  for (let n = 1; n <= LIMITS.refreshIp.limit + 1; n += 1) {
    const out = await call(service.handleRefresh, { headers: { 'x-real-ip': '192.0.2.5' } });
    if (out.status === 429) { blockedAt = n; break; }
    assert.equal(out.status, 401);
  }
  assert.equal(blockedAt, LIMITS.refreshIp.limit + 1);
});

test('로그아웃: Supabase 세션을 끝내고 쿠키를 지운다(접근 토큰이 없으면 쿠키로 갱신해서 끝낸다, 실패해도 쿠키는 지운다)', async () => {
  let service = makeService({ respond: () => ({ status: 204, body: null }) });
  let out = await call(service.handleLogout, { headers: { authorization: `Bearer ${ACCESS}`, cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.match(out.headers.get('set-cookie'), /^byteback_rt=; Max-Age=0;.*HttpOnly/u);
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].url, `${URL_BASE}/auth/v1/logout?scope=local`);
  assert.equal(upstream[0].headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(upstream[0].headers.apikey, PUBLISHABLE);

  service = makeService({ respond: (entry) => (entry.url.includes('grant_type=refresh_token') ? session : { status: 204, body: null }) });
  out = await call(service.handleLogout, { headers: { cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(out.status, 200);
  assert.deepEqual(upstream.map((entry) => entry.url.split('/auth/v1/')[1]), ['token?grant_type=refresh_token', 'logout?scope=local']);
  assert.equal(upstream[1].headers.Authorization, `Bearer ${ACCESS}`);

  service = createAuthService({ fetchImpl: async () => { throw new Error('network'); }, createDb: () => ({}) });
  out = await call(service.handleLogout, { headers: { authorization: `Bearer ${ACCESS}`, cookie: `byteback_rt=${REFRESH}` } });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/u);
  out = await call(makeService({ respond: () => session }).handleLogout, {});
  assert.equal(out.status, 200);
  assert.equal(upstream.length, 0);
  const cross = await call(service.handleLogout, { headers: { origin: 'https://evil.example.test' } });
  assert.equal(cross.status, 403);
  noSecretsLogged();
});

test('api/auth 파일 세 개가 기본 내보내기로 연결돼 있다', async () => {
  for (const name of ['login', 'refresh', 'logout']) {
    const { default: handler } = await import(`../api/auth/${name}.js`);
    const out = await call(handler, { method: 'GET' });
    assert.equal(out.status, 405, name);
    assert.equal(out.headers.get('cache-control'), 'no-store');
  }
});
