import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import handler from '../api/notes.js';

const FAKE_KEY = 'fake-key-for-test-only';
const originalFetch = globalThis.fetch;
const originalError = console.error;
let logged;

function call(method = 'GET') {
  const headers = new Map();
  const result = { headers };
  const response = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    status: (code) => { result.status = code; return { json: (body) => { result.body = body; } }; },
  };
  return handler({ method }, response).then(() => result);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

test('GET은 제목과 내용만 돌려주고 응답과 로그에 키가 없다', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify([{ title: '가', content: '나' }, { title: '다', content: '라' }]),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await call();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body, { notes: [{ title: '가', content: '나' }, { title: '다', content: '라' }] });
  assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
  assert.ok(!logged.join(' ').includes(FAKE_KEY));
});

test('GET이 아닌 요청은 405로 거절한다', async () => {
  const result = await call('POST');
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('allow'), 'GET');
});

test('서버 설정이 없으면 500이고 키 이름만 다루지 값은 새지 않는다', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  const result = await call();
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'SERVER_NOT_CONFIGURED');
});

test('DB 읽기가 실패하면 502이고 상세 내용과 키를 응답·로그에 남기지 않는다', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: '42501', message: `permission denied ${FAKE_KEY}` }),
    { status: 401, headers: { 'content-type': 'application/json' } });
  const result = await call();
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: 'NOTES_READ_FAILED' });
  assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
  assert.ok(!logged.join(' ').includes(FAKE_KEY));
});
