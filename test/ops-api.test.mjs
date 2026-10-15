import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { RULE_IDS } from '../src/decider.mjs';
import { createOpsService, MASK_CHARS } from '../src/ops-service.mjs';

const STUDENT = config.identityProvider;
const USER_A = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const USER_B = '5d2f6c8e-91aa-4c1b-8a55-3c0e2d7f4b21';
const NOTE_1 = 'a1111111-2222-4333-8444-555555555555';
const NOTE_2 = 'b6666666-7777-4888-9999-aaaaaaaaaaaa';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeToken = (marker) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: STUDENT.issuer, marker })}.c2ln`;
const TOKEN_A = fakeToken('a');
const TOKEN_B = fakeToken('b');
const SUBJECTS = new Map([[TOKEN_A, USER_A], [TOKEN_B, USER_B]]);
const fakeSupabase = {
  auth: {
    async getClaims(token) {
      const sub = SUBJECTS.get(token);
      if (!sub) return { data: null, error: new Error('bad signature') };
      return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub, exp: Math.floor(Date.now() / 1000) + 600 } }, error: null };
    },
  },
};

// restore_audit 표를 흉내 낸 메모리 DB(읽기만, owner_id 조건·최신순·줄 수 제한을 따름).
function makeDb(rows, state) {
  return {
    from(table) {
      assert.equal(table, 'restore_audit');
      const q = { filters: [], max: Infinity };
      q.select = (columns) => { state.columns = columns; return q; };
      q.eq = (column, value) => { q.filters.push([column, value]); return q; };
      q.order = () => q;
      q.limit = (n) => { q.max = n; return q; };
      q.then = (resolve) => {
        state.reads += 1;
        state.filters = q.filters;
        if (state.failRead) return resolve({ data: null, error: { code: 'XX000' } });
        return resolve({ data: rows.filter((r) => q.filters.every(([c, v]) => r[c] === v)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, q.max), error: null });
      };
      return q;
    },
  };
}

const originalError = console.error;
const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
let rows;
let state;
beforeEach(() => {
  rows = [];
  state = { reads: 0, failRead: false };
  console.error = () => {};
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'fake-key-for-test-only';
});
afterEach(() => {
  console.error = originalError;
  for (const [name, value] of [['SUPABASE_URL', originalEnv.url], ['SUPABASE_SECRET_KEY', originalEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

const service = (options = {}) => createOpsService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => makeDb(rows, state), ...options });
async function call(handler, { method = 'GET', headers = { authorization: `Bearer ${TOKEN_A}` } } = {}) {
  const out = { headers: {} };
  await handler({ method, url: '/api/ops', headers }, {
    setHeader(name, value) { out.headers[name] = value; },
    status(code) { out.status = code; return { json(value) { out.body = value; } }; },
  });
  return out;
}
const row = (n, over = {}) => ({ at: `2026-10-01T00:00:${String(n).padStart(2, '0')}Z`, owner_id: USER_A, note_id: NOTE_1, outcome: 'restored', status: 200, ...over });

test('로그인 없이는 401, GET이 아니면 405이고 DB를 읽지 않는다', async () => {
  const { handleOps } = service();
  assert.equal((await call(handleOps, { headers: {} })).status, 401);
  assert.equal((await call(handleOps, { headers: { authorization: 'Bearer not-a-token' } })).status, 401);
  assert.equal((await call(handleOps, { method: 'POST' })).status, 405);
  assert.equal(state.reads, 0);
});

test('규칙은 observed이고, 탐지 사건과 회수 상태는 값 없이 not_run', async () => {
  const out = await call(service().handleOps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.rules, { status: 'observed', ruleIds: [...RULE_IDS] });
  assert.deepEqual(out.body.detection, { status: 'not_run' });
  assert.deepEqual(out.body.revocation, { status: 'not_run' });
});

test('정책 사본은 검증해 단계·지문 앞 12자리, 깨진 사본은 not_run', async () => {
  const good = (await call(service().handleOps)).body.recovery.policySnapshot;
  assert.equal(good.status, 'observed');
  assert.match(good.digest, /^[0-9a-f]{12}$/u);
  assert.ok(Number.isInteger(good.step));
  const broken = (await call(service({ snapshot: { snapshotVersion: 1 } }).handleOps)).body.recovery.policySnapshot;
  assert.deepEqual(broken, { status: 'not_run' });
});

test('수치(전체 수·결과별 수)와 가린 기록이 같은 줄에서 나와 항상 맞는다', async () => {
  const TOTAL = 15;
  for (let n = 0; n < TOTAL; n += 1) rows.push(row(n, n % 3 === 0 ? { outcome: 'hash_mismatch', status: 409, note_id: NOTE_2 } : {}));
  const { audit } = (await call(service().handleOps)).body.recovery;
  assert.equal(audit.status, 'observed');
  assert.equal(audit.recent.length, TOTAL, '상한 없이 본인 줄을 전부 보여 줌');
  assert.equal(audit.total, audit.recent.length);
  const counted = {};
  for (const r of audit.recent) counted[r.outcome] = (counted[r.outcome] ?? 0) + 1;
  assert.deepEqual(audit.byOutcome, counted);
  assert.ok(audit.recent[0].at > audit.recent[1].at, '최근 줄이 먼저');
});

test('메모 번호는 앞 8자리만이고 응답에 전체 번호·사용자 ID·토큰·본문이 없다', async () => {
  rows.push({ ...row(1), title: '비밀 제목', body: '비밀 본문', email: 'a@example.com' }, row(2, { note_id: NOTE_2 }));
  const out = await call(service().handleOps);
  const text = JSON.stringify(out.body);
  assert.ok(text.includes(`${NOTE_1.slice(0, MASK_CHARS)}…`));
  for (const secret of [NOTE_1, NOTE_2, USER_A, TOKEN_A, '비밀 제목', '비밀 본문', 'a@example.com', 'fake-key-for-test-only']) {
    assert.ok(!text.includes(secret), `응답에 ${secret.slice(0, 6)}… 가 없어야 한다`);
  }
  assert.deepEqual(Object.keys(out.body.recovery.audit.recent[0]).sort(), ['at', 'noteId', 'outcome', 'status']);
});

test('본인 줄만 읽는다(남의 줄은 세지도 보이지도 않음)', async () => {
  rows.push(row(1), row(2, { owner_id: USER_B, outcome: 'forbidden', status: 403 }));
  const a = (await call(service().handleOps)).body.recovery.audit;
  assert.deepEqual(a.byOutcome, { restored: 1 });
  assert.deepEqual(state.filters, [['owner_id', USER_A]]);
  const b = (await call(service().handleOps, { headers: { authorization: `Bearer ${TOKEN_B}` } })).body.recovery.audit;
  assert.deepEqual(b.byOutcome, { forbidden: 1 });
});

test('감사 표를 못 읽으면 그 부분만 not_run이고 나머지는 그대로', async () => {
  state.failRead = true;
  const out = await call(service().handleOps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.recovery.audit, { status: 'not_run' });
  assert.equal(out.body.rules.status, 'observed');
});

test('허용 경로에 GET /api/ops가 있다', () => {
  assert.ok(config.allowedRoutes.includes('GET /api/ops'));
});
