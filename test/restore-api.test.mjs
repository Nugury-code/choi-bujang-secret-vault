import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { noteContentSha256 } from '../src/note-hash.mjs';
import { createNotesService } from '../src/notes-service.mjs';

const FAKE_KEY = 'fake-key-for-test-only';
const STUDENT = config.identityProvider;
const USER_A = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const USER_B = '5d2f6c8e-91aa-4c1b-8a55-3c0e2d7f4b21';
const A_NOTE = '11111111-1111-4111-8111-111111111111';
const B_NOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const originalError = console.error;
const originalLog = console.log;
let logged;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const fakeToken = (marker) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: STUDENT.issuer, marker })}.c2ln`;
const TOKEN_A = fakeToken('a');
const TOKEN_B = fakeToken('b');
const SUBJECTS = new Map([[TOKEN_A, USER_A], [TOKEN_B, USER_B]]);
const fakeSupabase = { auth: { async getClaims(token) {
  const sub = SUBJECTS.get(token);
  if (sub) return { data: { claims: { iss: STUDENT.issuer, aud: STUDENT.audience, role: 'authenticated', sub, exp: now() + 600 } }, error: null };
  return { data: null, error: new Error('bad signature') };
} } };

// 가짜 DB. 복구는 서버 코드가 사본 표·메모 표를 읽고(select), 메모 한 행을 고치거나 만들고(update·insert),
// 쓴 값이 틀릴 때만 복구 직전 모습으로 되돌립니다(update·delete). DB 함수(rpc)는 쓰지 않습니다.
function makeFakeDb(tables, state) {
  return {
    from(name) {
      if (name !== 'vault_notes' && name !== 'vault_notes_backup') throw new Error(`예상 밖의 표: ${name}`);
      const filters = [];
      let op = 'select';
      let values;
      const exec = () => {
        if (op === 'insert') {
          state.calls.push(`insert:${name}`);
          state.writes.push({ op, values: { ...values }, filters: [] });
          if (state.writeFails) return { data: null, error: { code: 'XX000', message: `secret ${FAKE_KEY}` } };
          if (tables[name].some((row) => row.note_id === values.note_id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          tables[name].push({ ...values });
          if (state.sloppyWrite) tables[name].find((row) => row.note_id === values.note_id).content = '엉뚱하게 써 버림';
          return { data: null, error: null };
        }
        const rows = tables[name].filter((row) => filters.every(([key, value]) => row[key] === value));
        if (op === 'select') {
          state.calls.push(`read:${name}`);
          if (state.readFails) return { data: null, error: { code: 'XX000', message: `secret ${FAKE_KEY}` } };
          if (name === 'vault_notes_backup') {
            state.backupReads += 1;
            if (state.driftOnReread && state.backupReads === 2 && rows[0]) return { data: { ...rows[0], content: '사본이 읽는 사이 바뀜' }, error: null };
          }
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        }
        state.calls.push(`${op}:${name}`);
        if (op === 'update') state.writes.push({ op, values: { ...values }, filters: filters.map(([k]) => k) });
        if (op === 'update' && state.writeFails && values.content === original.B.content) return { data: null, error: { code: 'XX000', message: `secret ${FAKE_KEY}` } };
        if (op === 'update') {
          rows.forEach((row) => Object.assign(row, values));
          if (state.sloppyWrite && values.content === original.B.content) rows.forEach((row) => { row.content = '엉뚱하게 써 버림'; });
        }
        if (op === 'delete') tables[name] = tables[name].filter((row) => !rows.includes(row));
        return { data: null, error: null };
      };
      const query = {
        select() { op = 'select'; return query; },
        insert(v) { op = 'insert'; values = v; return query; },
        update(v) { op = 'update'; values = v; return query; },
        delete() { op = 'delete'; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        maybeSingle: async () => exec(),
        then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
      };
      return query;
    },
    // 요청 횟수 제한 함수(rate_limit_hit)는 여기서 흉내 내지 않습니다: 없는 함수 오류가 오면 횟수 제한의 DB 부분은 건너뜁니다.
    rpc() { return { data: null, error: { code: 'PGRST202', message: 'not found' } }; },
  };
}

const original = {
  A: { note_id: A_NOTE, owner_id: USER_A, title: 'A 메모', content: 'A 내용' },
  B: { note_id: B_NOTE, owner_id: USER_B, title: 'B 메모', content: 'B 내용' },
  B2: { note_id: B_OTHER, owner_id: USER_B, title: 'B 메모 2', content: 'B 내용 2' },
};
const BACKED_UP_AT = '2026-10-13T00:00:00.000Z';
const backupRow = (note) => ({ ...note, content_sha256: noteContentSha256(note.title, note.content), backed_up_at: BACKED_UP_AT });
let tables;
let state;
let service;

function post(id, headers, extra = {}) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  const request = { method: 'POST', headers, url: `/api/notes/${id}/restore`, ...extra };
  return service.handleRestore(request, response).then(() => out);
}
// 사용자가 정한 흐름: 복원 요청 → 미리보기와 확인 코드만 옴(아무것도 안 바뀜) → 확인 코드를 붙여 다시 요청 → 복원.
// 두 번째 요청의 DB 호출 순서만 state.calls에 남깁니다.
async function postConfirmed(id, headers, body = {}) {
  const first = await post(id, headers, { body });
  assert.equal(first.status, 200); assert.equal(first.body.restored, false); assert.equal(first.body.confirmRequired, true);
  state.calls.length = 0;
  return post(id, headers, { body: { ...body, confirm: first.body.preview.confirmCode } });
}
function preview(id, headers) {
  const out = { headers: new Map() };
  const response = {
    setHeader: (key, value) => out.headers.set(key.toLowerCase(), value),
    status: (code) => { out.status = code; return { json: (b) => { out.body = b; } }; },
  };
  return service.handleRestore({ method: 'GET', headers, url: `/api/notes/${id}/restore` }, response).then(() => out);
}
const asA = { authorization: `Bearer ${TOKEN_A}` };
const asB = { authorization: `Bearer ${TOKEN_B}` };
const live = (id) => tables.vault_notes.find((row) => row.note_id === id);
const snapshotOf = () => JSON.stringify(tables);

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  console.log = (...args) => logged.push(args.join(' '));
  tables = {
    vault_notes: [{ ...original.A }, { ...original.B }, { ...original.B2 }],
    vault_notes_backup: [backupRow(original.B)],
  };
  state = { calls: [], writeFails: false, readFails: false, driftOnReread: false, sloppyWrite: false, backupReads: 0, writes: [] };
  service = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => makeFakeDb(tables, state) });
});
afterEach(() => {
  console.error = originalError; console.log = originalLog;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
});

test('내용 해시: 같은 제목·본문이면 같고, 경계가 다르면 다르다', () => {
  assert.match(noteContentSha256('a', 'b'), /^[0-9a-f]{64}$/u);
  assert.equal(noteContentSha256('a', 'b'), noteContentSha256('a', 'b'));
  assert.notEqual(noteContentSha256('ab', 'c'), noteContentSha256('a', 'bc'));
  assert.equal(noteContentSha256(1, 'b'), null);
});

test('B가 변조된 자기 메모 한 건을 복원: 사본과 id·소유자·해시가 같고 다른 행은 그대로', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const before = JSON.stringify([live(A_NOTE), live(B_OTHER), tables.vault_notes_backup]);
  const out = await postConfirmed(B_NOTE, asB);
  assert.equal(out.status, 200);
  const want = backupRow(original.B).content_sha256;
  assert.deepEqual(out.body, { id: B_NOTE, ownerId: USER_B, contentSha256: want, restored: true });
  assert.deepEqual(Object.keys(out.body).sort(), ['contentSha256', 'id', 'ownerId', 'restored']);
  assert.ok(!JSON.stringify(out.body).includes('변조된 내용'));
  const row = live(B_NOTE);
  assert.equal(row.note_id, B_NOTE); assert.equal(row.owner_id, USER_B);
  assert.equal(noteContentSha256(row.title, row.content), tables.vault_notes_backup[0].content_sha256);
  assert.equal(JSON.stringify([live(A_NOTE), live(B_OTHER), tables.vault_notes_backup]), before);
  assert.equal(out.headers.get('cache-control'), 'no-store');
  // 순서: 사본 읽기 → 지금 메모 읽기 → 쓰기 직전 사본 다시 읽기 → 그 한 건만 쓰기 → 쓴 뒤 다시 읽어 대조.
  assert.deepEqual(state.calls, ['read:vault_notes_backup', 'read:vault_notes', 'read:vault_notes_backup', 'update:vault_notes', 'read:vault_notes']);
});

test('B가 삭제된 자기 메모 한 건을 복원: 같은 id·소유자로 다시 생기고 다른 행은 그대로', async () => {
  tables.vault_notes.splice(tables.vault_notes.indexOf(live(B_NOTE)), 1);
  const before = JSON.stringify([live(A_NOTE), live(B_OTHER)]);
  const out = await postConfirmed(B_NOTE, asB);
  assert.equal(out.status, 200);
  assert.deepEqual(live(B_NOTE), { ...original.B });
  assert.equal(tables.vault_notes.length, 3);
  assert.equal(JSON.stringify([live(A_NOTE), live(B_OTHER)]), before);
});

test('이미 같은 메모를 복원해도 결과는 같다', async () => {
  const before = snapshotOf();
  assert.equal((await postConfirmed(B_NOTE, asB)).status, 200);
  assert.equal(snapshotOf(), before);
});

test('A는 B의 메모를 복원할 수 없다: 404, 아무것도 바뀌지 않고 B의 사본 존재도 알려 주지 않는다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asA);
  assert.equal(out.status, 404); assert.deepEqual(out.body, { error: 'NOT_FOUND' });
  assert.equal(snapshotOf(), before);
  const missing = await post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', asB);
  assert.equal(missing.status, 404); assert.deepEqual(missing.body, out.body);
});

test('사본의 내용 해시가 맞지 않으면 409로 멈추고 아무것도 쓰지 않는다', async () => {
  tables.vault_notes_backup[0].content = '바뀐 사본 내용';
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 409); assert.deepEqual(out.body, { error: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(snapshotOf(), before);
  assert.ok(logged.some((l) => l.includes('backup_hash_mismatch')));
});

test('로그인 없음 401, 가짜 토큰 401, GET·POST가 아니면 405, 모양이 다른 id는 DB 없이 404', async () => {
  assert.equal((await post(B_NOTE, {})).status, 401);
  assert.equal((await post(B_NOTE, { authorization: 'Bearer nope' })).status, 401);
  const wrongMethod = { headers: new Map() };
  await service.handleRestore({ method: 'PUT', headers: asB, url: `/api/notes/${B_NOTE}/restore` },
    { setHeader: () => {}, status: (c) => { wrongMethod.status = c; return { json: (b) => { wrongMethod.body = b; } }; } });
  assert.equal(wrongMethod.status, 405);
  for (const bad of ['not-a-uuid', 'export', '..']) assert.equal((await post(bad, asB)).status, 404);
  assert.deepEqual(state.calls, []);
});

test('DB 오류 응답과 로그에 키·메모 내용·소유자 ID가 없고, 성공 응답의 소유자는 본인 ID뿐이다', async () => {
  state.writeFails = true; Object.assign(live(B_NOTE), { title: 'x', content: '변조된 내용' });
  const out = await postConfirmed(B_NOTE, asB);
  assert.equal(out.status, 502);
  const text = JSON.stringify([out.body, logged]);
  for (const forbidden of [FAKE_KEY, 'B 내용', USER_B, USER_A, TOKEN_B]) assert.ok(!text.includes(forbidden), forbidden);
  state.writeFails = false; Object.assign(live(B_NOTE), { title: 'x' });
  const ok = await postConfirmed(B_NOTE, asB);
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify([ok.body, logged]).includes('B 내용'));
  // 성공 응답의 소유자는 요청한 본인(토큰으로 확인된 사용자)의 ID 하나뿐이고, 로그에는 사용자 ID가 남지 않는다.
  assert.equal(ok.body.ownerId, USER_B);
  assert.ok(!JSON.stringify(ok.body).includes(USER_A));
  assert.ok(!JSON.stringify(logged).includes(USER_B));
});

test('사본 읽기가 실패하면 502, 응답과 로그에 키가 없고 아무것도 쓰지 않는다', async () => {
  state.readFails = true;
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 502);
  assert.ok(!JSON.stringify([out.body, logged]).includes(FAKE_KEY));
  assert.ok(!state.calls.some((call) => call.startsWith('update:') || call.startsWith('insert:')));
});

test('요청 본문에서는 confirm만 읽는다: 본문에 id·owner_id·role·dryRun·사본 값이 있어도 대상과 결과가 같다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const out = await postConfirmed(B_NOTE, asB, { id: B_OTHER, owner_id: USER_A, role: 'instructor', dryRun: true, backup: { title: '다른 제목', content: '다른 내용' } });
  assert.equal(out.status, 200); assert.equal(out.body.restored, true);
  assert.equal(live(B_NOTE).title, original.B.title); assert.equal(live(B_NOTE).content, original.B.content);
  assert.equal(live(B_NOTE).owner_id, USER_B);
  assert.equal(JSON.stringify(live(B_OTHER)), JSON.stringify(original.B2));
});


// ---- 미리보기(GET): 복원할 버전과 바뀔 항목을 실행 전에 보여 주고, 아무것도 바꾸지 않는다 ----
test('미리보기: 변조된 메모는 복원할 버전과 바뀔 항목이 보이고, 아무것도 쓰지 않으며 원문은 응답에 없다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const before = snapshotOf();
  const out = await preview(B_NOTE, asB);
  assert.equal(out.status, 200);
  assert.match(out.body.preview.confirmCode, /^[0-9a-f]{16}$/u);
  delete out.body.preview.confirmCode;
  const want = backupRow(original.B);
  assert.deepEqual(out.body, {
    id: B_NOTE, ownerId: USER_B,
    preview: {
      restoreVersion: { contentSha256: want.content_sha256, backedUpAt: BACKED_UP_AT },
      current: { exists: true, contentSha256: noteContentSha256('변조됨', '변조된 내용') },
      changes: { recreate: false, title: true, content: true }, willChange: true,
    },
  });
  assert.equal(snapshotOf(), before);
  assert.ok(!state.calls.some((call) => call.startsWith('update:') || call.startsWith('insert:') || call.startsWith('delete:')));
  assert.ok(!JSON.stringify(out.body).includes('변조된 내용') && !JSON.stringify(out.body).includes('B 내용'));
});

test('미리보기: 삭제된 메모는 다시 만들어짐으로, 이미 같은 메모는 바뀔 것 없음으로 보인다', async () => {
  tables.vault_notes.splice(tables.vault_notes.indexOf(live(B_NOTE)), 1);
  const gone = await preview(B_NOTE, asB);
  assert.deepEqual(gone.body.preview.changes, { recreate: true, title: true, content: true });
  assert.deepEqual(gone.body.preview.current, { exists: false, contentSha256: null });
  tables.vault_notes.push({ ...original.B });
  const same = await preview(B_NOTE, asB);
  assert.deepEqual(same.body.preview.changes, { recreate: false, title: false, content: false });
  assert.equal(same.body.preview.willChange, false);
});

test('미리보기도 사본이 없거나 다른 사람 것이면 404, 사본 검증에 실패하면 409로 멈춘다', async () => {
  assert.equal((await preview(B_NOTE, asA)).status, 404);
  assert.equal((await preview('dddddddd-dddd-4ddd-8ddd-dddddddddddd', asB)).status, 404);
  tables.vault_notes_backup[0].content = '바뀐 사본 내용';
  const before = snapshotOf();
  const out = await preview(B_NOTE, asB);
  assert.equal(out.status, 409); assert.deepEqual(out.body, { error: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(snapshotOf(), before);
  assert.equal((await preview(B_NOTE, {})).status, 401);
});

test('복원 뒤: B의 A 메모 요청은 여전히 거부되고, A의 정상 요청과 다른 메모는 그대로다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  assert.equal((await postConfirmed(B_NOTE, asB)).status, 200);
  assert.equal(JSON.stringify(live(A_NOTE)), JSON.stringify(original.A));
  assert.equal((await post(A_NOTE, asB)).status, 404);
  assert.equal((await preview(A_NOTE, asB)).status, 404);
  assert.equal(JSON.stringify(live(A_NOTE)), JSON.stringify(original.A));
});

// ---- 확인 흐름: 복원 요청은 먼저 미리보기만 보여 주고, 확인 코드를 붙여야 복원된다 ----
test('확인 코드 없이 복원을 요청하면 미리보기와 확인 코드만 오고 아무것도 바뀌지 않는다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 200);
  assert.equal(out.body.restored, false); assert.equal(out.body.confirmRequired, true);
  assert.deepEqual(out.body.preview.changes, { recreate: false, title: true, content: true });
  assert.equal(out.body.preview.willChange, true);
  assert.equal(out.body.preview.restoreVersion.contentSha256, backupRow(original.B).content_sha256);
  assert.equal(snapshotOf(), before);
  assert.ok(!state.calls.some((call) => call.startsWith('update:') || call.startsWith('insert:') || call.startsWith('delete:')));
  assert.ok(!JSON.stringify(out.body).includes('변조된 내용') && !JSON.stringify(out.body).includes('B 내용'));
});

test('틀린 확인 코드나 문자열이 아닌 확인 값은 복원하지 못하고 미리보기를 다시 보여 준다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const before = snapshotOf();
  for (const confirm of ['0000000000000000', '', 1, null, { x: 1 }]) {
    const out = await post(B_NOTE, asB, { body: { confirm } });
    assert.equal(out.status, 200); assert.equal(out.body.restored, false); assert.equal(out.body.confirmRequired, true);
  }
  assert.equal((await post(B_NOTE, asB, { body: '이건 JSON이 아님' })).body.restored, false);
  assert.equal(snapshotOf(), before);
});

test('미리본 뒤 메모가 또 바뀌면 이전 확인 코드로는 복원되지 않고 새 미리보기가 나온다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const first = await post(B_NOTE, asB);
  Object.assign(live(B_NOTE), { title: '미리본 뒤 또 변조됨' });
  const before = snapshotOf();
  const stale = await post(B_NOTE, asB, { body: { confirm: first.body.preview.confirmCode } });
  assert.equal(stale.body.restored, false); assert.equal(stale.body.confirmRequired, true);
  assert.notEqual(stale.body.preview.confirmCode, first.body.preview.confirmCode);
  assert.equal(snapshotOf(), before);
  assert.equal((await post(B_NOTE, asB, { body: { confirm: stale.body.preview.confirmCode } })).body.restored, true);
});

test('A는 B의 확인 코드를 알아도 B의 메모를 복원할 수 없다', async () => {
  const code = (await post(B_NOTE, asB)).body.preview.confirmCode;
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asA, { body: { confirm: code } });
  assert.equal(out.status, 404); assert.deepEqual(out.body, { error: 'NOT_FOUND' });
  assert.equal(snapshotOf(), before);
});

// ---- 쓰기 직전 사본 다시 읽기, 쓴 뒤 확인 실패 시 되돌리기 ----
test('쓰기 직전에 사본을 다시 읽어 달라졌으면 409로 멈추고 아무것도 쓰지 않는다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const first = await post(B_NOTE, asB);
  state.backupReads = 0; state.driftOnReread = true; // 이번 요청의 첫 읽기는 정상, 쓰기 직전 두 번째 읽기에서 사본이 달라져 있음
  const before = snapshotOf();
  const out = await post(B_NOTE, asB, { body: { confirm: first.body.preview.confirmCode } });
  assert.equal(out.status, 409); assert.deepEqual(out.body, { error: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(snapshotOf(), before);
  assert.ok(logged.some((l) => l.includes('backup_changed_before_write')));
});

test('쓴 뒤 확인이 실패하면 이 한 건을 쓰기 전 모습으로 되돌리고 502로 알린다 (다른 메모는 그대로)', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  state.sloppyWrite = true; // 가짜 DB가 사본 내용을 쓰려 할 때 엉뚱한 값을 저장하게 만든다
  const others = JSON.stringify([live(A_NOTE), live(B_OTHER), tables.vault_notes_backup]);
  const out = await postConfirmed(B_NOTE, asB);
  assert.equal(out.status, 502); assert.deepEqual(out.body, { error: 'RESTORE_VERIFY_FAILED' });
  assert.equal(live(B_NOTE).title, '변조됨'); assert.equal(live(B_NOTE).content, '변조된 내용'); assert.equal(live(B_NOTE).owner_id, USER_B);
  assert.equal(JSON.stringify([live(A_NOTE), live(B_OTHER), tables.vault_notes_backup]), others);
  assert.ok(logged.some((l) => l.includes('restore_verify_failed_undone')));
  assert.ok(!JSON.stringify([out.body, logged]).includes('엉뚱하게'));
});

test('삭제돼 있던 메모를 다시 만든 뒤 확인이 실패하면 만든 행을 지워 원래대로(없음) 돌린다', async () => {
  tables.vault_notes.splice(tables.vault_notes.indexOf(live(B_NOTE)), 1);
  state.sloppyWrite = true;
  const out = await postConfirmed(B_NOTE, asB);
  assert.equal(out.status, 502);
  assert.equal(live(B_NOTE), undefined);
  assert.equal(tables.vault_notes.length, 2);
});
