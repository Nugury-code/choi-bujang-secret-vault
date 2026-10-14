import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { createDeviceService, DEVICE_LIMITS, proofText } from '../src/device-service.mjs';
import { createMemoryLimiter } from '../src/rate-limit.mjs';

const STUDENT = config.identityProvider;
const USER_A = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const USER_B = '5d2f6c8e-91aa-4c1b-8a55-3c0e2d7f4b21';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeToken = (marker) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: STUDENT.issuer, marker })}.c2ln`;
const TOKEN_A = fakeToken('a');
const TOKEN_B = fakeToken('b');
const SUBJECTS = new Map([[TOKEN_A, USER_A], [TOKEN_B, USER_B]]);
const exp = () => Math.floor(Date.now() / 1000) + 600;
const fakeSupabase = {
  auth: {
    async getClaims(token) {
      const sub = SUBJECTS.get(token);
      if (!sub) return { data: null, error: new Error('bad signature') };
      return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub, exp: exp() } }, error: null };
    },
  },
};

// device_requests 표를 흉내 낸 메모리 DB. 서버 역할처럼 select와 insert만 되고, insert에 status를 정하면 거부합니다.
function makeDb(rows, state) {
  return {
    from(table) {
      assert.equal(table, 'device_requests');
      const query = { filters: [] };
      query.select = () => query;
      query.eq = (column, value) => { query.filters.push((row) => row[column] === value); return query; };
      query.maybeSingle = () => {
        state.reads += 1;
        if (state.failRead) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        const found = rows.find((row) => query.filters.every((fn) => fn(row)));
        return Promise.resolve({ data: found ? { status: found.status } : null, error: null });
      };
      query.insert = (values) => {
        state.inserts.push(values);
        assert.deepEqual(Object.keys(values).sort(), ['fingerprint', 'owner_id', 'public_key'], '서버는 status를 정하지 않는다');
        if (rows.some((row) => row.owner_id === values.owner_id && row.fingerprint === values.fingerprint)) {
          return Promise.resolve({ error: { code: '23505' } });
        }
        rows.push({ ...values, status: 'pending' });
        return Promise.resolve({ error: null });
      };
      return query;
    },
  };
}

function makeDevice() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const fingerprint = createHash('sha256').update(spki).digest('hex');
  return {
    fingerprint,
    proof(signedAt = Date.now(), overrides = {}) {
      const signature = sign('sha256', Buffer.from(proofText(fingerprint, signedAt), 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
      return { publicKey: spki.toString('base64'), signature: signature.toString('base64'), signedAt, ...overrides };
    },
    spki,
    privateKey,
  };
}

const originalError = console.error;
const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
let rows;
let state;
let logged;
beforeEach(() => {
  rows = [];
  state = { reads: 0, inserts: [], failRead: false };
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'fake-key-for-test-only';
});
afterEach(() => {
  console.error = originalError;
  for (const [name, value] of [['SUPABASE_URL', originalEnv.url], ['SUPABASE_SECRET_KEY', originalEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

function service(options = {}) {
  return createDeviceService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => makeDb(rows, state), ...options });
}
async function call(handler, { method = 'POST', headers = { authorization: `Bearer ${TOKEN_A}` }, body } = {}) {
  const out = { headers: {} };
  await handler({ method, url: '/api/device', headers, body }, {
    setHeader(name, value) { out.headers[name] = value; },
    status(code) { out.status = code; return { json(value) { out.body = value; } }; },
  });
  return out;
}

test('로그인 없이는 401, 메서드가 POST가 아니면 405이고 DB를 부르지 않는다', async () => {
  const { handleDevice } = service();
  assert.equal((await call(handleDevice, { headers: {} })).status, 401);
  assert.equal((await call(handleDevice, { headers: { authorization: 'Bearer not-a-token' } })).status, 401);
  const wrong = await call(handleDevice, { method: 'GET' });
  assert.equal(wrong.status, 405);
  assert.equal(state.reads + state.inserts.length, 0);
});

test('새 기기 요청은 대기(pending)로만 들어가고 승인 상태가 되지 않는다', async () => {
  const device = makeDevice();
  const out = await call(service().handleDevice, { body: device.proof() });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { status: 'pending' });
  assert.equal(state.inserts.length, 1);
  assert.equal(rows[0].owner_id, USER_A);
  assert.equal(rows[0].fingerprint, device.fingerprint);
  // 같은 기기가 다시 눌러도 줄이 늘지 않고 여전히 대기입니다(요청 단추만으로 권한이 생기지 않음).
  const again = await call(service().handleDevice, { body: device.proof() });
  assert.deepEqual(again.body, { status: 'pending' });
  assert.equal(rows.length, 1);
});

test('주인이 DB에서 승인으로 바꾼 뒤에만 approved가 돌아온다', async () => {
  const device = makeDevice();
  await call(service().handleDevice, { body: device.proof() });
  assert.deepEqual((await call(service().handleDevice, { body: device.proof() })).body, { status: 'pending' });
  rows[0].status = 'approved';
  assert.deepEqual((await call(service().handleDevice, { body: device.proof() })).body, { status: 'approved' });
  rows[0].status = 'rejected';
  assert.deepEqual((await call(service().handleDevice, { body: device.proof() })).body, { status: 'rejected' });
});

test('다른 계정은 같은 기기여도 별도 요청이고, 남의 승인을 물려받지 않는다', async () => {
  const device = makeDevice();
  await call(service().handleDevice, { body: device.proof() });
  rows[0].status = 'approved';
  const asB = await call(service().handleDevice, { headers: { authorization: `Bearer ${TOKEN_B}` }, body: device.proof() });
  assert.deepEqual(asB.body, { status: 'pending' });
  assert.equal(rows.length, 2);
});

test('서명이 맞지 않거나 오래됐거나 모양이 틀리면 400이고 DB를 쓰지 않는다', async () => {
  const device = makeDevice();
  const other = makeDevice();
  const cases = [
    device.proof(Date.now(), { signature: other.proof().signature }),                // 다른 키의 서명
    device.proof(Date.now(), { publicKey: other.spki.toString('base64') }),           // 남의 공개 키를 베낌
    device.proof(Date.now() - 120_000),                                                // 오래된 서명
    device.proof(Date.now() + 120_000),                                                // 미래 서명
    { ...device.proof(), signedAt: '123' },
    { ...device.proof(), publicKey: 'AAAA' },
    { ...device.proof(), publicKey: 123 },
    {},
    null,
    [],
    'not json',
  ];
  for (const body of cases) {
    const out = await call(service().handleDevice, { body });
    assert.equal(out.status, 400, JSON.stringify(body)?.slice(0, 60));
    assert.deepEqual(out.body, { error: 'INVALID_DEVICE_PROOF' });
  }
  assert.equal(state.reads + state.inserts.length, 0);
  assert.equal(rows.length, 0);
});

test('본문의 status·owner_id·userId는 무시되고 서버는 status를 정하지 않는다', async () => {
  const device = makeDevice();
  const out = await call(service().handleDevice, { body: device.proof(Date.now(), { status: 'approved', owner_id: USER_B, userId: USER_B, role: 'instructor' }) });
  assert.deepEqual(out.body, { status: 'pending' });
  assert.equal(rows[0].owner_id, USER_A);
  assert.deepEqual(Object.keys(state.inserts[0]).sort(), ['fingerprint', 'owner_id', 'public_key']);
});

test('응답과 로그에 공개 키·지문·사용자 ID·토큰이 없다', async () => {
  const device = makeDevice();
  const out = await call(service().handleDevice, { body: device.proof() });
  const text = JSON.stringify(out) + logged.join('\n');
  for (const secret of [device.fingerprint, device.spki.toString('base64'), USER_A, TOKEN_A]) assert.ok(!text.includes(secret));
  assert.deepEqual(Object.keys(out.body), ['status']);
  state.failRead = true;
  const failed = await call(service().handleDevice, { body: device.proof() });
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: 'DEVICE_REQUEST_FAILED' });
  assert.ok(!logged.join('\n').includes(TOKEN_A));
});

test('서버 설정이 없으면 500이고, 횟수 제한을 넘으면 429이다', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await call(service().handleDevice, { body: makeDevice().proof() })).status, 500);
  process.env.SUPABASE_SECRET_KEY = 'fake-key-for-test-only';
  const limited = service({ memory: createMemoryLimiter() });
  const device = makeDevice();
  for (let n = 0; n < DEVICE_LIMITS.user.limit; n += 1) {
    assert.equal((await call(limited.handleDevice, { body: device.proof() })).status, 200, `요청 ${n + 1}`);
  }
  const blocked = await call(limited.handleDevice, { body: device.proof() });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['Retry-After']);
});

test('화면: 승인 전에는 자료를 부르지 않고, 키를 저장소에 넣지 않으며, 서버 status만 믿는다', async () => {
  const appJs = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const html = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  assert.match(appJs, /if \(userId && deviceStatus !== 'approved'\)/u);
  assert.match(appJs, /기기 승인 전에는 자료를 표시하지 않습니다/u);
  assert.match(appJs, /generateKey\(\{ name: 'ECDSA', namedCurve: 'P-256' \}, false, \['sign'\]\)/u);
  assert.match(appJs, /\['pending', 'approved', 'rejected'\]\.includes\(result\.data\?\.status\)/u);
  assert.doesNotMatch(appJs, /localStorage|sessionStorage|indexedDB|document\.cookie|exportKey\('(?:jwk|pkcs8|raw)'/u);
  assert.ok(html.includes('id="device-request"'));
  assert.match(html, /id="device-status"/u);
  assert.ok(config.allowedRoutes.includes('POST /api/device'));
});
