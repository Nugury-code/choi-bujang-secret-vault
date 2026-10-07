import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { createNotesService } from '../src/notes-service.mjs';

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
    or(text) {
      const [mine, none] = text.split(',');
      const owner = mine.replace('owner_id.eq.', '');
      assert.equal(none, 'owner_id.is.null');
      this.filters.push((row) => row.owner_id === owner || row.owner_id === null);
      return this;
    }
    order() { return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
    run() {
      state.calls += 1;
      if (state.failCode) return { data: null, error: { code: state.failCode, message: `secret ${FAKE_KEY}` } };
      const matched = rows.filter((row) => this.filters.every((fn) => fn(row)));
      const pick = (list) => list.map(({ note_id, title, content }) => ({ note_id, title, content }));
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

function call(handlerName, { method = 'GET', headers = {}, url, query, body } = {}) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  return service[handlerName]({ method, headers, url, query, body }, response).then(() => out);
}
const asA = { authorization: `Bearer ${TOKEN_A}` };
const asB = { authorization: `Bearer ${TOKEN_B}` };
const list = (headers = asA) => call('handleCollection', { headers, url: '/api/notes' });
const item = (id, method = 'GET', extra = {}) => call('handleItem', { method, url: `/api/notes/${id}`, headers: asA, ...extra });

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  rows = [
    { note_id: SEED_1, owner_id: null, title: '처음 메모 1', content: '처음 내용 1' },
    { note_id: SEED_2, owner_id: null, title: '처음 메모 2', content: '처음 내용 2' },
    { note_id: '33333333-3333-4333-8333-333333333333', owner_id: USER_B, title: 'B의 메모', content: 'B 내용' },
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

test('목록 GET: 로그인 사용자의 메모와 처음 메모를 {id,title,body} 배열로 주고 남의 메모는 뺀다', async () => {
  const result = await list();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body, [
    { id: SEED_1, title: '처음 메모 1', body: '처음 내용 1' },
    { id: SEED_2, title: '처음 메모 2', body: '처음 내용 2' },
  ]);
  const forB = await list(asB);
  assert.deepEqual(forB.body.map((n) => n.title), ['처음 메모 1', '처음 메모 2', 'B의 메모']);
  for (const secret of [FAKE_KEY, TOKEN_A]) assert.ok(!JSON.stringify(result.body).includes(secret));
});

test('추가·한 건 조회·수정·삭제·삭제 뒤 404: A의 전체 흐름', async () => {
  const id = '9f6b1f4e-2f0f-4f55-9f6d-0a5f2b6c7d88';
  const created = await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { id, title: '  새 메모  ', body: '새 내용' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id });
  assert.equal(rows.at(-1).owner_id, USER_A, '서버가 확인한 사용자 ID가 owner_id로 저장되어야 한다');
  assert.equal(rows.at(-1).title, '새 메모');

  const one = await item(id);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body, { id, title: '새 메모', body: '새 내용' });
  assert.ok((await list()).body.some((n) => n.id === id));

  const edited = await item(id, 'PUT', { body: { title: '고친 제목', body: '고친 내용' } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body, { id, title: '고친 제목', body: '고친 내용' });
  assert.deepEqual((await item(id)).body, { id, title: '고친 제목', body: '고친 내용' });

  const removed = await item(id, 'DELETE');
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { id });
  const gone = await item(id);
  assert.equal(gone.status, 404);
  assert.equal((await item(id, 'DELETE')).status, 404);
  assert.equal((await item(id, 'PUT', { body: { title: 'x', body: 'y' } })).status, 404);
  assert.ok(!(await list()).body.some((n) => n.id === id));
});

test('id가 없으면 서버가 UUID를 만들어 {id}로 돌려주고, 같은 id를 또 쓰면 409', async () => {
  const created = await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { title: 't', body: 'b' } });
  assert.equal(created.status, 201);
  assert.match(created.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual(Object.keys(created.body), ['id']);
  const again = await call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body: { id: created.body.id, title: 't', body: 'b' } });
  assert.equal(again.status, 409);
});

test('무로그인·위조·만료 토큰은 모든 경로와 메서드에서 401이고 DB를 건드리지 않는다', async () => {
  const bad = [{}, { authorization: 'Bearer aaa.bbb.ccc' }, { authorization: `Bearer ${fakeToken('forged')}` },
    { authorization: `Bearer ${fakeToken('expired')}` }, { authorization: `Basic ${TOKEN_A}` }];
  for (const headers of bad) {
    const results = [
      await call('handleCollection', { method: 'GET', headers, url: '/api/notes' }),
      await call('handleCollection', { method: 'POST', headers, url: '/api/notes', body: { title: 't', body: 'b' } }),
      await call('handleItem', { method: 'GET', headers, url: `/api/notes/${SEED_1}` }),
      await call('handleItem', { method: 'PUT', headers, url: `/api/notes/${SEED_1}`, body: { title: 't', body: 'b' } }),
      await call('handleItem', { method: 'DELETE', headers, url: `/api/notes/${SEED_1}` }),
    ];
    for (const result of results) {
      assert.equal(result.status, 401, JSON.stringify(headers));
      assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
    }
  }
  assert.equal(state.calls, 0);
  assert.equal(rows.length, 3);
});

test('브라우저가 보낸 owner_id·userId·role은 저장되지 않는다', async () => {
  const created = await call('handleCollection', {
    method: 'POST', headers: { ...asA, 'x-user-id': USER_B }, url: '/api/notes?userId=' + USER_B,
    query: { userId: USER_B },
    body: { title: 't', body: 'b', owner_id: USER_B, userId: USER_B, role: 'admin', note_id: SEED_1 },
  });
  assert.equal(created.status, 201);
  const saved = rows.at(-1);
  assert.equal(saved.owner_id, USER_A);
  assert.notEqual(saved.note_id, SEED_1);
  assert.equal(saved.role, undefined);
  const edited = await item(saved.note_id, 'PUT', { body: { title: 't2', body: 'b2', owner_id: USER_B } });
  assert.equal(edited.status, 200);
  assert.equal(rows.at(-1).owner_id, USER_A);
});

test('값 검사: 제목·내용이 없거나 너무 길거나 id가 UUID가 아니면 400, 모양이 이상한 주소 id는 404', async () => {
  const post = (body) => call('handleCollection', { method: 'POST', headers: asA, url: '/api/notes', body });
  for (const body of [undefined, null, 'text', [], {}, { title: '', body: 'b' }, { title: '   ', body: 'b' },
    { title: 't' }, { title: 't', body: 5 }, { title: 'x'.repeat(121), body: 'b' }, { title: 't', body: 'x'.repeat(5001) }]) {
    const result = await post(body);
    assert.equal(result.status, 400, JSON.stringify(body)?.slice(0, 40));
    assert.deepEqual(result.body, { error: 'INVALID_NOTE' });
  }
  const badId = await post({ id: 'not-a-uuid', title: 't', body: 'b' });
  assert.equal(badId.status, 400);
  assert.deepEqual(badId.body, { error: 'INVALID_ID' });
  assert.equal((await post('{"title":"문자열 본문","body":"ok"}')).status, 201);
  const callsBefore = state.calls;
  for (const id of ['abc', "1' or '1'='1", '../x', `${SEED_1}x`]) {
    assert.equal((await item(encodeURIComponent(id))).status, 404);
  }
  assert.equal(state.calls, callsBefore, 'UUID 모양이 아닌 id로는 DB를 부르지 않는다');
  assert.equal((await item(SEED_1, 'PUT', { body: { title: '', body: 'b' } })).status, 400);
});

test('주소의 id가 우선이고 ?id= 쿼리로 바꿔치기할 수 없다', async () => {
  const result = await call('handleItem', { method: 'GET', headers: asA, url: `/api/notes/${SEED_1}?id=${SEED_2}`, query: { id: SEED_2 } });
  assert.equal(result.body.id, SEED_1);
  const viaQuery = await call('handleItem', { method: 'GET', headers: asA, url: undefined, query: { id: SEED_2 } });
  assert.equal(viaQuery.body.id, SEED_2);
});

test('허용하지 않은 메서드는 405와 Allow 헤더', async () => {
  const a = await call('handleCollection', { method: 'DELETE', headers: asA, url: '/api/notes' });
  assert.equal(a.status, 405);
  assert.equal(a.headers.get('allow'), 'GET, POST');
  const b = await call('handleItem', { method: 'POST', headers: asA, url: `/api/notes/${SEED_1}` });
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
  const write = await item(SEED_1, 'PUT', { body: { title: 't', body: 'b' } });
  assert.equal(write.status, 502);
  assert.deepEqual(write.body, { error: 'NOTES_WRITE_FAILED' });
  for (const secret of [FAKE_KEY, TOKEN_A, 'secret']) {
    assert.ok(!JSON.stringify([read, write]).includes(secret));
    assert.ok(!logged.join(' ').includes(secret));
  }
});

test('심판(judge) 발급 토큰은 도우미 규칙대로 통과하고 위조 서명은 거부한다', async () => {
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
  const run = (token) => new Promise((resolve) => {
    const out = {};
    judgeService.handleCollection({ method: 'POST', headers: { authorization: `Bearer ${token}` }, url: '/api/notes', body: { title: 't', body: 'b' } },
      { setHeader() {}, status: (code) => ({ json: (body) => { out.status = code; out.body = body; resolve(out); } }) });
  });
  assert.equal((await run(await sign(privateKey))).status, 201);
  assert.equal(rows.at(-1).owner_id, judgeId);
  const other = await generateKeyPair('ES256');
  assert.equal((await run(await sign(other.privateKey))).status, 401);
});

test('실제 Supabase SDK가 만드는 요청 모양: 목록·추가·한 건·수정·삭제', async () => {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: decodeURIComponent(request.url), body: init.body ? JSON.parse(init.body) : null,
      prefer: request.headers.get('prefer') });
    const data = request.method === 'POST' ? null : [{ note_id: SEED_1, title: 't', content: 'c' }];
    return new Response(data ? JSON.stringify(request.headers.get('accept')?.includes('vnd.pgrst.object') ? data[0] : data) : null,
      { status: request.method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } });
  };
  const real = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase } });
  const run = (name, req) => new Promise((resolve) => {
    const out = {};
    real[name]({ headers: asA, ...req }, { setHeader() {}, status: (code) => ({ json: (body) => { out.status = code; out.body = body; resolve(out); } }) });
  });
  await run('handleCollection', { method: 'GET', url: '/api/notes' });
  await run('handleCollection', { method: 'POST', url: '/api/notes', body: { id: SEED_2, title: 'T', body: 'B', owner_id: USER_B } });
  await run('handleItem', { method: 'GET', url: `/api/notes/${SEED_1}` });
  await run('handleItem', { method: 'PUT', url: `/api/notes/${SEED_1}`, body: { title: 'T2', body: 'B2' } });
  await run('handleItem', { method: 'DELETE', url: `/api/notes/${SEED_1}` });
  const [listReq, postReq, getReq, putReq, delReq] = requests;
  assert.equal(listReq.method, 'GET');
  assert.match(listReq.url, new RegExp(`select=note_id,title,content`, 'u'));
  assert.ok(listReq.url.includes(`or=(owner_id.eq.${USER_A},owner_id.is.null)`));
  assert.ok(listReq.url.includes('order=id.asc'));
  assert.equal(postReq.method, 'POST');
  assert.deepEqual(postReq.body, { note_id: SEED_2, owner_id: USER_A, title: 'T', content: 'B' });
  assert.equal(getReq.method, 'GET');
  assert.ok(getReq.url.includes(`note_id=eq.${SEED_1}`));
  assert.equal(putReq.method, 'PATCH');
  assert.deepEqual(putReq.body, { title: 'T2', content: 'B2' });
  assert.ok(putReq.url.includes(`note_id=eq.${SEED_1}`));
  assert.equal(delReq.method, 'DELETE');
  assert.ok(delReq.url.includes(`note_id=eq.${SEED_1}`));
  assert.ok(requests.every((r) => !JSON.stringify(r).includes('role')));
});

test('aleph.config.json: identityProvider에 비밀이 없고 allowedRoutes가 실제 경로와 같다', () => {
  assert.deepEqual(Object.keys(STUDENT).sort(), ['audience', 'issuer', 'jwksUrl']);
  assert.ok(!/sb_secret_|service_role|eyJ/u.test(JSON.stringify(STUDENT)));
  assert.deepEqual([...config.allowedRoutes].sort(), [
    'DELETE /api/notes/:id', 'GET /api/notes', 'GET /api/notes/:id', 'POST /api/notes', 'PUT /api/notes/:id',
  ]);
});

test('api 파일 두 개가 같은 서비스를 기본 내보내기로 연결하고, 토큰 없이는 401이다', async () => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  const { default: collection } = await import('../api/notes.js');
  const { default: itemHandler } = await import('../api/notes/[id].js');
  for (const [handler, method, url] of [[collection, 'GET', '/api/notes'], [collection, 'POST', '/api/notes'],
    [itemHandler, 'GET', `/api/notes/${SEED_1}`], [itemHandler, 'PUT', `/api/notes/${SEED_1}`], [itemHandler, 'DELETE', `/api/notes/${SEED_1}`]]) {
    const out = {};
    await handler({ method, url, headers: {} }, { setHeader() {}, status: (code) => ({ json: (body) => { out.status = code; out.body = body; } }) });
    assert.equal(out.status, 401, `${method} ${url}`);
    assert.deepEqual(out.body, { error: 'UNAUTHORIZED' });
  }
});
