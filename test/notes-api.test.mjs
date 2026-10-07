import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { createNotesService, NOTES_LIMITS } from '../src/notes-service.mjs';
import { createMemoryLimiter } from '../src/rate-limit.mjs';

const FAKE_KEY = 'fake-key-for-test-only';
const STUDENT = config.identityProvider;
const USER_A = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const USER_B = '5d2f6c8e-91aa-4c1b-8a55-3c0e2d7f4b21';
const SEED_1 = '11111111-1111-4111-8111-111111111111';
const SEED_2 = '22222222-2222-4222-8222-222222222222';
const originalFetch = globalThis.fetch;
const originalError = console.error;
let logged;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function fakeToken(marker, overrides = {}) {
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: STUDENT.issuer, marker, ...overrides })}.c2ln`;
}
const TOKEN_A = fakeToken('a');
const TOKEN_B = fakeToken('b');
const SUBJECTS = new Map([[TOKEN_A, USER_A], [TOKEN_B, USER_B]]);

// 도우미(src/verify-login.mjs)는 그대로 쓰고 Supabase 서버 호출 부분만 가짜 클라이언트로 바꿉니다.
const fakeSupabase = {
  auth: {
    async getClaims(token) {
      const sub = SUBJECTS.get(token);
      if (sub) {
        return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub, exp: now() + 600 } }, error: null };
      }
      if (token === fakeToken('expired')) {
        return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub: USER_A, exp: now() - 10 } }, error: null };
      }
      return { data: null, error: new Error('bad signature') };
    },
  },
};

// 메모 표를 흉내 낸 메모리 DB. 공식 SDK가 쓰는 체인(select/or/eq/order/insert/update/delete/maybeSingle)만 지원합니다.
function makeFakeDb(rows, state) {
  class Query {
    constructor() { this.op = 'select'; this.filters = []; this.returning = false; }
    select() { if (this.op !== 'select') this.returning = true; return this; }
    insert(values) { this.op = 'insert'; this.values = values; return this; }
    update(values) { this.op = 'update'; this.values = values; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    order() { return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
    run() {
      state.calls += 1;
      if (state.failCode) return { data: null, error: { code: state.failCode, message: `secret ${FAKE_KEY}` } };
      const matched = rows.filter((row) => this.filters.every((fn) => fn(row)));
      const pick = (list) => list.map(({ note_id, title, content, owner_id }) => ({ note_id, title, content, owner_id }));
      const out = (list) => ({ data: this.single ? (pick(list)[0] ?? null) : pick(list), error: null });
      if (this.op === 'insert') {
        if (rows.some((row) => row.note_id === this.values.note_id)) return { data: null, error: { code: '23505' } };
        rows.push({ owner_id: null, ...this.values });
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        for (const row of matched) Object.assign(row, this.values);
        return out(matched);
      }
      if (this.op === 'delete') {
        for (const row of matched) rows.splice(rows.indexOf(row), 1);
        return { data: pick(matched), error: null };
      }
      return out(matched);
    }
  }
  return { from: (table) => { assert.equal(table, 'vault_notes'); return new Query(); } };
}

let rows;
let state;
let service;

function call(handlerName, { method = 'GET', headers = {}, url, query, body } = {}, target = service) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  return target[handlerName]({ method, headers, url, query, body }, response).then(() => out);
}
const asA = { authorization: `Bearer ${TOKEN_A}` };
const asB = { authorization: `Bearer ${TOKEN_B}` };
const list = (headers = asA) => call('handleCollection', { headers, url: '/api/notes' });
const create = (headers, body) => call('handleCollection', { method: 'POST', headers, url: '/api/notes', body });
const item = (id, method = 'GET', headers = asA, extra = {}) => call('handleItem', { method, url: `/api/notes/${id}`, headers, ...extra });
const rowOf = (id) => rows.find((row) => row.note_id === id);

const A_NOTE = '11111111-1111-4111-8111-111111111111';
const A_NOTE_2 = '22222222-2222-4222-8222-222222222222';
const B_NOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEGACY = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  rows = [
    { note_id: A_NOTE, owner_id: USER_A, title: 'A 메모 1', content: 'A 내용 1' },
    { note_id: A_NOTE_2, owner_id: USER_A, title: 'A 메모 2', content: 'A 내용 2' },
    { note_id: B_NOTE, owner_id: USER_B, title: 'B 메모', content: 'B 내용' },
    { note_id: LEGACY, owner_id: null, title: '주인 없는 메모', content: '주인 없는 내용' },
  ];
  state = { calls: 0, failCode: null };
  service = createNotesService({
    verifierOptions: { supabaseClient: fakeSupabase },
    createDb: () => makeFakeDb(rows, state),
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

test('목록 GET: 각자 자기 메모만 {id,title,body}로 받고 남의 메모·주인 없는 메모는 빠진다', async () => {
  const forA = await list(asA);
  assert.equal(forA.status, 200);
  assert.equal(forA.headers.get('cache-control'), 'no-store');
  assert.deepEqual(forA.body, [
    { id: A_NOTE, title: 'A 메모 1', body: 'A 내용 1' },
    { id: A_NOTE_2, title: 'A 메모 2', body: 'A 내용 2' },
  ]);
  const forB = await list(asB);
  assert.deepEqual(forB.body, [{ id: B_NOTE, title: 'B 메모', body: 'B 내용' }]);
  for (const result of [forA, forB]) {
    assert.ok(!JSON.stringify(result.body).includes('owner'));
    assert.ok(!JSON.stringify(result.body).includes('주인 없는'));
  }
});

test('A와 B는 각자 자기 메모의 추가·조회·수정·삭제를 그대로 할 수 있다', async () => {
  for (const [headers, userId] of [[asA, USER_A], [asB, USER_B]]) {
    const id = crypto.randomUUID();
    const created = await create(headers, { id, title: '  새 메모  ', body: '새 내용' });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id });
    assert.equal(rowOf(id).owner_id, userId, '추가할 때 서버가 확인한 사용자 ID로 저장된다');
    assert.deepEqual((await item(id, 'GET', headers)).body, { id, title: '새 메모', body: '새 내용' });
    const edited = await item(id, 'PUT', headers, { body: { title: '고친 제목', body: '고친 내용' } });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body, { id, title: '고친 제목', body: '고친 내용' });
    assert.equal(rowOf(id).owner_id, userId);
    assert.equal((await item(id, 'DELETE', headers)).status, 200);
    assert.equal((await item(id, 'GET', headers)).status, 404);
    assert.ok(!rowOf(id));
  }
});

test('B는 A의 메모를 읽을 수 없다(404, 내용 없음)', async () => {
  const result = await item(A_NOTE, 'GET', asB);
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: 'NOT_FOUND' });
  assert.ok(!JSON.stringify(result).includes('A 메모'));
  // A도 B의 메모는 같은 방식으로 막힌다.
  assert.equal((await item(B_NOTE, 'GET', asA)).status, 404);
  // 남의 메모와 없는 메모의 응답이 같아서 존재 여부를 알 수 없다.
  const missing = await item(crypto.randomUUID(), 'GET', asB);
  assert.deepEqual(missing.body, result.body);
  assert.equal(missing.status, result.status);
});

test('B는 A의 메모를 수정할 수 없고 A의 메모는 그대로다', async () => {
  const before = JSON.stringify(rowOf(A_NOTE));
  const result = await item(A_NOTE, 'PUT', asB, { body: { title: '탈취', body: '탈취' } });
  assert.equal(result.status, 404);
  assert.equal(JSON.stringify(rowOf(A_NOTE)), before);
  // 본문에 자기 ID를 owner_id로 적어도 소유권을 가져갈 수 없다.
  const steal = await item(A_NOTE, 'PUT', asB, { body: { title: '탈취', body: '탈취', owner_id: USER_B } });
  assert.equal(steal.status, 404);
  assert.equal(JSON.stringify(rowOf(A_NOTE)), before);
});

test('B는 A의 메모를 삭제할 수 없고 A의 메모는 그대로 남는다', async () => {
  const result = await item(A_NOTE, 'DELETE', asB);
  assert.equal(result.status, 404);
  assert.equal(rowOf(A_NOTE).owner_id, USER_A);
  assert.equal((await item(A_NOTE, 'GET', asA)).status, 200);
  assert.equal((await item(B_NOTE, 'DELETE', asA)).status, 404);
  assert.ok(rowOf(B_NOTE));
});

test('수정할 때 소유자를 바꾸려는 요청은 403으로 거부되고 아무것도 바뀌지 않는다', async () => {
  const before = JSON.stringify(rows);
  for (const owner of [{ owner_id: USER_B }, { ownerId: USER_B }, { user_id: USER_B }, { userId: USER_B }, { owner_id: null }, { owner_id: 5 }]) {
    const result = await item(A_NOTE, 'PUT', asA, { body: { title: 't', body: 'b', ...owner } });
    assert.equal(result.status, 403, JSON.stringify(owner));
    assert.deepEqual(result.body, { error: 'OWNER_CHANGE_NOT_ALLOWED' });
  }
  assert.equal(JSON.stringify(rows), before);
  // 확인된 자기 ID를 그대로 적은 요청은 문제없이 수정된다(소유자는 그대로 나).
  const same = await item(A_NOTE, 'PUT', asA, { body: { title: '같은 주인', body: 'b', owner_id: USER_A } });
  assert.equal(same.status, 200);
  assert.equal(rowOf(A_NOTE).owner_id, USER_A);
});

test('추가할 때 본문·쿼리·헤더의 owner_id는 무시하고 확인된 ID로 저장하며, 남의 메모 id로는 덮어쓸 수 없다', async () => {
  const created = await call('handleCollection', {
    method: 'POST', headers: { ...asA, 'x-user-id': USER_B }, url: `/api/notes?owner_id=${USER_B}`,
    query: { owner_id: USER_B }, body: { title: 't', body: 'b', owner_id: USER_B, userId: USER_B, role: 'admin' },
  });
  assert.equal(created.status, 201);
  const saved = rowOf(created.body.id);
  assert.equal(saved.owner_id, USER_A);
  assert.equal(saved.role, undefined);
  // B가 A의 메모와 같은 id로 추가해도 A의 메모는 바뀌지 않는다.
  const before = JSON.stringify(rowOf(A_NOTE));
  const clash = await create(asB, { id: A_NOTE, title: '덮어쓰기', body: '덮어쓰기' });
  assert.equal(clash.status, 409);
  assert.equal(JSON.stringify(rowOf(A_NOTE)), before);
});

test('주인이 없는 메모는 누구도 읽거나 고치거나 지울 수 없다', async () => {
  for (const headers of [asA, asB]) {
    assert.equal((await item(LEGACY, 'GET', headers)).status, 404);
    assert.equal((await item(LEGACY, 'PUT', headers, { body: { title: 't', body: 'b' } })).status, 404);
    assert.equal((await item(LEGACY, 'DELETE', headers)).status, 404);
  }
  assert.equal(rowOf(LEGACY).owner_id, null);
});

test('DB가 조건을 어기고 남의 행을 돌려줘도 코드의 소유자 비교가 한 번 더 막는다', async () => {
  const leaky = createNotesService({
    verifierOptions: { supabaseClient: fakeSupabase },
    createDb: () => ({
      from: () => {
        const query = {
          select: () => query, eq: () => query, order: () => query, update: () => query, delete: () => query,
          maybeSingle: () => query,
          then: (resolve) => resolve({ data: { note_id: A_NOTE, title: 'A 메모 1', content: 'A 내용 1', owner_id: USER_A }, error: null }),
        };
        return query;
      },
    }),
  });
  for (const method of ['GET', 'PUT']) {
    const result = await call('handleItem', { method, url: `/api/notes/${A_NOTE}`, headers: asB, body: { title: 't', body: 'b' } }, leaky);
    assert.equal(result.status, 404, method);
    assert.ok(!JSON.stringify(result.body).includes('A 메모'));
  }
  const listing = createNotesService({
    verifierOptions: { supabaseClient: fakeSupabase },
    createDb: () => ({
      from: () => {
        const query = {
          select: () => query, eq: () => query, order: () => query,
          then: (resolve) => resolve({ data: [{ note_id: A_NOTE, title: 'A 메모 1', content: 'A 내용 1', owner_id: USER_A }], error: null }),
        };
        return query;
      },
    }),
  });
  assert.deepEqual((await call('handleCollection', { headers: asB, url: '/api/notes' }, listing)).body, []);
});

test('무로그인·위조·만료 토큰은 모든 경로와 메서드에서 401이고 DB를 건드리지 않는다', async () => {
  const bad = [{}, { authorization: 'Bearer aaa.bbb.ccc' }, { authorization: `Bearer ${fakeToken('forged')}` },
    { authorization: `Bearer ${fakeToken('expired')}` }, { authorization: `Basic ${TOKEN_A}` }];
  for (const headers of bad) {
    const results = [
      await call('handleCollection', { method: 'GET', headers, url: '/api/notes' }),
      await call('handleCollection', { method: 'POST', headers, url: '/api/notes', body: { title: 't', body: 'b' } }),
      await call('handleItem', { method: 'GET', headers, url: `/api/notes/${A_NOTE}` }),
      await call('handleItem', { method: 'PUT', headers, url: `/api/notes/${A_NOTE}`, body: { title: 't', body: 'b' } }),
      await call('handleItem', { method: 'DELETE', headers, url: `/api/notes/${A_NOTE}` }),
    ];
    for (const result of results) {
      assert.equal(result.status, 401, JSON.stringify(headers));
      assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
    }
  }
  assert.equal(state.calls, 0);
  assert.equal(rows.length, 4);
});

test('값 검사: 제목·내용이 없거나 너무 길거나 id가 UUID가 아니면 400, 모양이 이상한 주소 id는 404', async () => {
  for (const body of [undefined, null, 'text', [], {}, { title: '', body: 'b' }, { title: '   ', body: 'b' },
    { title: 't' }, { title: 't', body: 5 }, { title: 'x'.repeat(121), body: 'b' }, { title: 't', body: 'x'.repeat(5001) }]) {
    const result = await create(asA, body);
    assert.equal(result.status, 400, JSON.stringify(body)?.slice(0, 40));
    assert.deepEqual(result.body, { error: 'INVALID_NOTE' });
  }
  const badId = await create(asA, { id: 'not-a-uuid', title: 't', body: 'b' });
  assert.equal(badId.status, 400);
  assert.deepEqual(badId.body, { error: 'INVALID_ID' });
  assert.equal((await create(asA, '{"title":"문자열 본문","body":"ok"}')).status, 201);
  const callsBefore = state.calls;
  for (const id of ['abc', "1' or '1'='1", '../x', `${A_NOTE}x`]) {
    assert.equal((await item(encodeURIComponent(id))).status, 404);
  }
  assert.equal(state.calls, callsBefore, 'UUID 모양이 아닌 id로는 DB를 부르지 않는다');
  assert.equal((await item(A_NOTE, 'PUT', asA, { body: { title: '', body: 'b' } })).status, 400);
});

test('주소의 id가 우선이고 ?id= 쿼리로 바꿔치기할 수 없다', async () => {
  const result = await call('handleItem', { method: 'GET', headers: asA, url: `/api/notes/${A_NOTE}?id=${B_NOTE}`, query: { id: B_NOTE } });
  assert.equal(result.body.id, A_NOTE);
  const viaQuery = await call('handleItem', { method: 'GET', headers: asA, url: undefined, query: { id: A_NOTE_2 } });
  assert.equal(viaQuery.body.id, A_NOTE_2);
  const forbidden = await call('handleItem', { method: 'GET', headers: asA, url: `/api/notes/${A_NOTE}?id=${B_NOTE}&owner_id=${USER_B}`, query: { id: B_NOTE, owner_id: USER_B } });
  assert.equal(forbidden.body.id, A_NOTE);
});

test('허용하지 않은 메서드는 405와 Allow 헤더', async () => {
  const a = await call('handleCollection', { method: 'DELETE', headers: asA, url: '/api/notes' });
  assert.equal(a.status, 405);
  assert.equal(a.headers.get('allow'), 'GET, POST');
  const b = await call('handleItem', { method: 'POST', headers: asA, url: `/api/notes/${A_NOTE}` });
  assert.equal(b.status, 405);
  assert.equal(b.headers.get('allow'), 'GET, PUT, DELETE');
  assert.equal(state.calls, 0);
});

test('서버 설정이 없으면 500, DB 오류는 502이며 키·토큰·상세 내용이 응답과 로그에 없다', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await list()).body.error, 'SERVER_NOT_CONFIGURED');
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  state.failCode = '42501';
  const read = await list();
  assert.equal(read.status, 502);
  assert.deepEqual(read.body, { error: 'NOTES_READ_FAILED' });
  const write = await item(A_NOTE, 'PUT', asA, { body: { title: 't', body: 'b' } });
  assert.equal(write.status, 502);
  assert.deepEqual(write.body, { error: 'NOTES_WRITE_FAILED' });
  for (const secret of [FAKE_KEY, TOKEN_A, 'secret']) {
    assert.ok(!JSON.stringify([read, write]).includes(secret));
    assert.ok(!logged.join(' ').includes(secret));
  }
});

test('심판(judge) 발급 토큰은 자기 메모만 다루고 학생 A의 메모에는 닿지 못한다', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const judgeKeySet = createLocalJWKSet({ keys: [jwk] });
  const appHost = new URL(config.publicAppUrl).hostname;
  const judgeId = crypto.randomUUID();
  const sign = (key) => new SignJWT({ aleph_run: crypto.randomUUID(), aleph_role: 'judge', aleph_identity: 'a' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(config.judgeIssuer).setAudience(appHost).setSubject(judgeId)
    .setIssuedAt().setExpirationTime('5m').sign(key);
  const judgeService = createNotesService({
    verifierOptions: { supabaseClient: fakeSupabase, judgeKeySet },
    createDb: () => makeFakeDb(rows, state),
  });
  const judge = { authorization: `Bearer ${await sign(privateKey)}` };
  const created = await call('handleCollection', { method: 'POST', headers: judge, url: '/api/notes', body: { title: '심판 메모', body: 'x' } }, judgeService);
  assert.equal(created.status, 201);
  assert.equal(rowOf(created.body.id).owner_id, judgeId);
  // 학생 A는 심판의 메모를, 심판은 학생 A의 메모를 읽고 고치고 지우지 못한다.
  assert.equal((await item(created.body.id, 'GET', asA)).status, 404);
  assert.equal((await item(created.body.id, 'PUT', asA, { body: { title: 't', body: 'b' } })).status, 404);
  assert.equal((await item(created.body.id, 'DELETE', asA)).status, 404);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await call('handleItem', { method, headers: judge, url: `/api/notes/${A_NOTE}`, body: { title: 't', body: 'b' } }, judgeService);
    assert.equal(result.status, 404, method);
  }
  assert.ok(rowOf(created.body.id) && rowOf(A_NOTE).title === 'A 메모 1');
  const other = await generateKeyPair('ES256');
  const forged = await call('handleCollection', { headers: { authorization: `Bearer ${await sign(other.privateKey)}` }, url: '/api/notes' }, judgeService);
  assert.equal(forged.status, 401);
});

test('실제 Supabase SDK가 만드는 요청 모양: 모든 요청에 note_id와 owner_id 조건이 함께 붙는다', async () => {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: decodeURIComponent(request.url), body: init.body ? JSON.parse(init.body) : null });
    // 횟수 제한 함수 호출(rpc)은 아래에서 따로 확인합니다. 가짜로 "허용"을 돌려줍니다.
    if (request.url.includes('/rest/v1/rpc/rate_limit_hit')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const row = { note_id: A_NOTE, title: 't', content: 'c', owner_id: USER_A };
    const wantsObject = request.headers.get('accept')?.includes('vnd.pgrst.object');
    return new Response(request.method === 'POST' ? null : JSON.stringify(wantsObject ? row : [row]),
      { status: request.method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } });
  };
  const real = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase } });
  await call('handleCollection', { headers: asA, url: '/api/notes' }, real);
  await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { id: A_NOTE_2, title: 'T', body: 'B', owner_id: USER_B } }, real);
  await call('handleItem', { headers: asA, url: `/api/notes/${A_NOTE}` }, real);
  await call('handleItem', { method: 'PUT', headers: asA, url: `/api/notes/${A_NOTE}`, body: { title: 'T2', body: 'B2' } }, real);
  await call('handleItem', { method: 'DELETE', headers: asA, url: `/api/notes/${A_NOTE}` }, real);
  const limitCalls = requests.filter((r) => r.url.includes('/rest/v1/rpc/rate_limit_hit'));
  assert.equal(limitCalls.length, 3, '쓰기 세 번(추가·수정·삭제)만 DB 횟수 제한을 부릅니다');
  assert.ok(limitCalls.every((r) => r.body.p_limit === 60 && r.body.p_window_seconds === 60 && !JSON.stringify(r.body).includes(USER_A)));
  const [listReq, postReq, getReq, putReq, delReq] = requests.filter((r) => !r.url.includes('/rest/v1/rpc/'));
  assert.ok(listReq.url.includes(`owner_id=eq.${USER_A}`));
  assert.ok(!listReq.url.includes('is.null'));
  assert.deepEqual(postReq.body, { note_id: A_NOTE_2, owner_id: USER_A, title: 'T', content: 'B' });
  for (const req of [getReq, putReq, delReq]) {
    assert.ok(req.url.includes(`note_id=eq.${A_NOTE}`), req.method);
    assert.ok(req.url.includes(`owner_id=eq.${USER_A}`), req.method);
  }
  assert.equal(putReq.method, 'PATCH');
  assert.deepEqual(putReq.body, { title: 'T2', content: 'B2', owner_id: USER_A });
  assert.equal(delReq.method, 'DELETE');
  assert.ok(requests.every((r) => !JSON.stringify(r).includes(USER_B)));
});

test('api 파일 두 개가 같은 서비스를 기본 내보내기로 연결하고, 토큰 없이는 401이다', async () => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  const { default: collection } = await import('../api/notes.js');
  const { default: itemHandler } = await import('../api/notes/[id].js');
  for (const [handler, method, url] of [[collection, 'GET', '/api/notes'], [collection, 'POST', '/api/notes'],
    [itemHandler, 'GET', `/api/notes/${A_NOTE}`], [itemHandler, 'PUT', `/api/notes/${A_NOTE}`], [itemHandler, 'DELETE', `/api/notes/${A_NOTE}`]]) {
    const out = {};
    await handler({ method, url, headers: {} }, { setHeader() {}, status: (code) => ({ json: (body) => { out.status = code; out.body = body; } }) });
    assert.equal(out.status, 401, `${method} ${url}`);
    assert.deepEqual(out.body, { error: 'UNAUTHORIZED' });
  }
});

test('aleph.config.json: identityProvider에 비밀이 없고 allowedRoutes가 실제 메서드·경로와 같다', () => {
  assert.deepEqual(Object.keys(STUDENT).sort(), ['audience', 'issuer', 'jwksUrl']);
  assert.ok(!/sb_secret_|service_role|eyJ/u.test(JSON.stringify(STUDENT)));
  assert.deepEqual([...config.allowedRoutes].sort(), [
    'DELETE /api/notes/:id', 'GET /api/notes', 'GET /api/notes/:id', 'POST /api/auth/login', 'POST /api/auth/logout',
    'POST /api/auth/refresh', 'POST /api/notes', 'PUT /api/notes/:id',
  ]);
});

// ---- 요청 횟수 제한(5단계 보강) ----
test('IP별 제한: 같은 IP가 한도를 넘으면 로그인 토큰 검사 전에 429, 다른 IP는 그대로', async () => {
  const limited = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => makeFakeDb(rows, state) });
  const headers = { ...asA, 'x-real-ip': '203.0.113.7' };
  for (let n = 0; n < NOTES_LIMITS.ip.limit; n += 1) {
    const out = await call('handleCollection', { headers, url: '/api/notes' }, limited);
    assert.equal(out.status, 200, `요청 ${n + 1}`);
  }
  const blocked = await call('handleCollection', { headers: { 'x-real-ip': '203.0.113.7', authorization: 'Bearer not-a-token' }, url: '/api/notes' }, limited);
  assert.equal(blocked.status, 429, '토큰이 엉망이어도 401이 아니라 429(검사 전에 끊음)');
  assert.deepEqual(blocked.body, { error: 'RATE_LIMITED' });
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  const other = await call('handleCollection', { headers: { ...asA, 'x-real-ip': '203.0.113.8' }, url: '/api/notes' }, limited);
  assert.equal(other.status, 200);
  const callsBefore = state.calls;
  await call('handleItem', { headers, url: `/api/notes/${A_NOTE}` }, limited);
  assert.equal(state.calls, callsBefore, '막힌 요청은 DB를 부르지 않는다');
});

test('사용자별 쓰기 제한: 한도를 넘은 추가·수정·삭제는 429이고 DB에 닿지 않으며, 읽기와 다른 사용자는 영향이 없다', async () => {
  const limited = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => makeFakeDb(rows, state),
    memory: createMemoryLimiter() });
  const writes = NOTES_LIMITS.userWrite.limit;
  const headersFor = (token, n) => ({ authorization: `Bearer ${token}`, 'x-real-ip': `198.51.100.${n % 200 + 1}` });
  for (let n = 0; n < writes; n += 1) {
    const out = await call('handleCollection', { method: 'POST', headers: headersFor(TOKEN_A, n), url: '/api/notes', body: { title: `t${n}`, body: 'b' } }, limited);
    assert.equal(out.status, 201, `쓰기 ${n + 1}`);
  }
  const count = rows.length;
  const callsBefore = state.calls;
  for (const [method, path, handler] of [['POST', '/api/notes', 'handleCollection'], ['PUT', `/api/notes/${A_NOTE}`, 'handleItem'], ['DELETE', `/api/notes/${A_NOTE}`, 'handleItem']]) {
    const out = await call(handler, { method, headers: headersFor(TOKEN_A, 7), url: path, body: { title: 'x', body: 'y' } }, limited);
    assert.equal(out.status, 429, method);
    assert.deepEqual(out.body, { error: 'RATE_LIMITED' });
  }
  assert.equal(rows.length, count);
  assert.ok(rowOf(A_NOTE), '막힌 삭제는 아무것도 지우지 않는다');
  assert.equal(state.calls, callsBefore);
  assert.equal((await call('handleCollection', { headers: headersFor(TOKEN_A, 9), url: '/api/notes' }, limited)).status, 200, '읽기는 막지 않음');
  assert.equal((await call('handleCollection', { method: 'POST', headers: headersFor(TOKEN_B, 11), url: '/api/notes', body: { title: 'b', body: 'b' } }, limited)).status, 201, 'B는 별개');
});

test('DB 쓰기 제한: 공유 숫자가 한도를 넘었다고 하면 쓰기는 429, 읽기는 DB 제한을 부르지 않고, 키에 사용자 ID가 그대로 들어가지 않는다', async () => {
  const sent = [];
  const db = { ...makeFakeDb(rows, state), rpc: async (name, args) => { sent.push({ name, args }); return { data: [{ allowed: false, retry_after: 33 }], error: null }; } };
  const limited = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => db });
  const read = await call('handleCollection', { headers: asA, url: '/api/notes' }, limited);
  assert.equal(read.status, 200);
  assert.equal(sent.length, 0);
  const blocked = await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { title: 'x', body: 'y' } }, limited);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '33');
  assert.equal(rows.some((row) => row.title === 'x'), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, 'rate_limit_hit');
  assert.ok(!JSON.stringify(sent).includes(USER_A) && /^[0-9a-f]{40}$/u.test(sent[0].args.p_key));
  // DB 제한이 고장 나도(함수 없음) 쓰기는 계속 처리합니다.
  const broken = { ...makeFakeDb(rows, state), rpc: async () => ({ data: null, error: { code: '42883' } }) };
  const fallback = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => broken });
  assert.equal((await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { title: 'ok', body: 'y' } }, fallback)).status, 201);
});
