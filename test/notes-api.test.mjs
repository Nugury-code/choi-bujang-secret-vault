import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { createNotesHandler } from '../api/notes.js';

const FAKE_KEY = 'fake-key-for-test-only';
const STUDENT = config.identityProvider;
const USER_ID = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const originalFetch = globalThis.fetch;
const originalError = console.error;
let logged;
let dbCalls;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function fakeStudentToken(overrides = {}) {
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: STUDENT.issuer, sub: USER_ID, ...overrides })}.c2ln`;
}
const GOOD = fakeStudentToken({ marker: 'good' });
const now = () => Math.floor(Date.now() / 1000);

// 도우미(src/verify-login.mjs)는 그대로 쓰고, Supabase 서버 호출 부분만 가짜 클라이언트로 바꿉니다.
const fakeSupabase = {
  auth: {
    async getClaims(token) {
      if (token === GOOD) {
        return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub: USER_ID, exp: now() + 600 } }, error: null };
      }
      if (token === fakeStudentToken({ marker: 'expired' })) {
        return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub: USER_ID, exp: now() - 10 } }, error: null };
      }
      if (token === fakeStudentToken({ marker: 'anon' })) {
        return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'anon', sub: USER_ID, exp: now() + 600 } }, error: null };
      }
      if (token === fakeStudentToken({ marker: 'wrong-aud' })) {
        return { data: { claims: { iss: STUDENT.issuer, aud: 'other', role: 'authenticated', sub: USER_ID, exp: now() + 600 } }, error: null };
      }
      return { data: null, error: new Error('bad signature') };
    },
  },
};

const handler = createNotesHandler({ verifierOptions: { supabaseClient: fakeSupabase } });

function call({ method = 'GET', headers = {}, query = {}, body } = {}, h = handler) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  return h({ method, headers, query, body }, response).then(() => out);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  logged = [];
  dbCalls = 0;
  console.error = (...args) => logged.push(args.join(' '));
  globalThis.fetch = async () => {
    dbCalls += 1;
    return new Response(JSON.stringify([{ title: '가', content: '나' }, { title: '다', content: '라' }]),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

test('정상 학생 토큰이면 제목과 내용만 돌려주고 응답·로그에 키와 토큰이 없다', async () => {
  const result = await call({ headers: { authorization: `Bearer ${GOOD}` } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body, { notes: [{ title: '가', content: '나' }, { title: '다', content: '라' }] });
  for (const secret of [FAKE_KEY, GOOD]) {
    assert.ok(!JSON.stringify(result.body).includes(secret));
    assert.ok(!logged.join(' ').includes(secret));
  }
});

test('토큰이 없거나 모양이 틀리면 DB를 읽지 않고 401로 자료 없이 거부한다', async () => {
  const cases = [{}, { authorization: '' }, { authorization: 'Bearer' }, { authorization: 'Bearer abc' },
    { authorization: `Basic ${GOOD}` }, { authorization: GOOD }, { authorization: `bearer ${GOOD}` }];
  for (const headers of cases) {
    const result = await call({ headers });
    assert.equal(result.status, 401, JSON.stringify(headers));
    assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
    assert.equal(result.headers.get('www-authenticate'), 'Bearer');
  }
  assert.equal(dbCalls, 0);
});

test('위조·만료·audience 불일치·anon 역할·다른 발급자 토큰은 401이다', async () => {
  const tokens = [
    fakeStudentToken({ marker: 'forged' }),
    fakeStudentToken({ marker: 'expired' }),
    fakeStudentToken({ marker: 'wrong-aud' }),
    fakeStudentToken({ marker: 'anon' }),
    fakeStudentToken({ iss: 'https://evil.example.com/auth/v1' }),
  ];
  for (const token of tokens) {
    const result = await call({ headers: { authorization: `Bearer ${token}` } });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
  }
  assert.equal(dbCalls, 0);
});

test('브라우저가 보낸 userId·role·쿼리·본문은 결과를 바꾸지 못한다', async () => {
  const headers = { 'x-user-id': USER_ID, 'x-role': 'admin' };
  const query = { userId: USER_ID, role: 'admin' };
  const denied = await call({ headers, query, body: { role: 'admin', userId: USER_ID } });
  assert.equal(denied.status, 401);
  assert.equal(dbCalls, 0);
  const allowed = await call({ headers: { ...headers, authorization: `Bearer ${GOOD}` }, query });
  assert.equal(allowed.status, 200);
});

test('심판(judge) 발급 토큰은 도우미 규칙대로 통과하고 위조 서명은 거부한다', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const judgeKeySet = createLocalJWKSet({ keys: [jwk] });
  const appHost = new URL(config.publicAppUrl).hostname;
  const uuid4 = () => crypto.randomUUID();
  const sign = (key) => new SignJWT({ aleph_run: uuid4(), aleph_role: 'judge', aleph_identity: 'a' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(config.judgeIssuer).setAudience(appHost).setSubject(uuid4())
    .setIssuedAt().setExpirationTime('5m').sign(key);
  const judgeHandler = createNotesHandler({ verifierOptions: { supabaseClient: fakeSupabase, judgeKeySet } });
  const ok = await call({ headers: { authorization: `Bearer ${await sign(privateKey)}` } }, judgeHandler);
  assert.equal(ok.status, 200);
  const other = await generateKeyPair('ES256');
  const bad = await call({ headers: { authorization: `Bearer ${await sign(other.privateKey)}` } }, judgeHandler);
  assert.equal(bad.status, 401);
});

test('GET이 아닌 요청은 405로 거절한다', async () => {
  const result = await call({ method: 'POST', headers: { authorization: `Bearer ${GOOD}` } });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('allow'), 'GET');
  assert.equal(dbCalls, 0);
});

test('서버 설정이 없으면 500이고 키 값은 새지 않는다', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  const result = await call({ headers: { authorization: `Bearer ${GOOD}` } });
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'SERVER_NOT_CONFIGURED');
});

test('DB 읽기가 실패하면 502이고 상세 내용과 키를 응답·로그에 남기지 않는다', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: '42501', message: `permission denied ${FAKE_KEY}` }),
    { status: 401, headers: { 'content-type': 'application/json' } });
  const result = await call({ headers: { authorization: `Bearer ${GOOD}` } });
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: 'NOTES_READ_FAILED' });
  assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
  assert.ok(!logged.join(' ').includes(FAKE_KEY));
});

test('aleph.config.json의 identityProvider에는 비밀 값이 없고 공개 주소만 있다', () => {
  assert.deepEqual(Object.keys(STUDENT).sort(), ['audience', 'issuer', 'jwksUrl']);
  assert.equal(STUDENT.jwksUrl, `${STUDENT.issuer}/.well-known/jwks.json`);
  assert.ok(!/sb_secret_|service_role|eyJ/u.test(JSON.stringify(STUDENT)));
});
