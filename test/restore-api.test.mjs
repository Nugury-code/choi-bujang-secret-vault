import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { noteContentSha256 } from '../src/note-hash.mjs';
import { createNotesService } from '../src/notes-service.mjs';
import { readPin } from '../src/restore-pin.mjs';

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

// 가짜 DB. 복구는 서버 코드가 DB 함수 restore_one_note를 한 번 부르는 것뿐이므로 rpc만 흉내 냅니다.
// 이 가짜 함수는 supabase/005_restore_function.sql 과 같은 순서로(사본 읽기 → 소유자·해시 확인 → 쓰기 → 쓴 뒤 확인) 일하고,
// 한 단계라도 틀리면 아무것도 바꾸지 않은 채 오류를 돌려줍니다(진짜 함수는 트랜잭션이 자동으로 취소합니다).
// 진짜 SQL 함수는 이 가짜가 아니라 실제 Postgres에서 따로 시험했습니다(README 참고).
function makeFakeDb(tables, state) {
  const err = (message, code = 'P0001') => ({ data: null, error: { code, message } });
  return {
    // 감사 기록 표(restore_audit)만 쓸 수 있고, 다른 표를 직접 만지면 시험이 실패합니다.
    from(name) {
      if (name !== 'restore_audit') throw new Error('복구는 rpc 한 번과 감사 기록만 써야 합니다');
      return { insert: async (row) => {
        if (state.auditFails) return { error: { code: 'PGRST205', message: 'secret ' + FAKE_KEY } };
        state.audit.push(row);
        return { error: null };
      } };
    },
    rpc(name, args) {
      // 요청 횟수 제한 함수(rate_limit_hit)는 여기서 흉내 내지 않습니다: 없는 함수 오류가 오면 횟수 제한의 DB 부분은 건너뜁니다.
      if (name !== 'restore_one_note') return { data: null, error: { code: 'PGRST202', message: 'not found' } };
      state.calls.push(`rpc:${name}:${args.p_dry_run ? 'dry' : 'run'}`);
      if (state.failRpc) return err(`secret ${FAKE_KEY}`, 'XX000');
      if (state.badReply && state.badReplyOwner) return { data: { id: args.p_note_id, ownerId: USER_A, restored: true, contentSha256: noteContentSha256('B 메모', 'B 내용') }, error: null };
      if (state.badReply) return { data: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', ownerId: USER_B, restored: true, contentSha256: 'x' }, error: null };
      const id = args.p_note_id;
      const owner = args.p_owner_id;
      const b = tables.vault_notes_backup.find((row) => row.note_id === id && row.owner_id === owner);
      if (!b) return err('BACKUP_NOT_FOUND', 'P0002');
      if (noteContentSha256(b.title, b.content) !== b.content_sha256) return err('BACKUP_INTEGRITY_FAILED');
      const want = args.p_expected;
      if (want && typeof want === 'object' && ((typeof want.title === 'string' && want.title !== b.title)
        || (typeof want.content === 'string' && want.content !== b.content))) return err('REQUEST_MISMATCH');
      const l = tables.vault_notes.find((row) => row.note_id === id && row.owner_id === owner);
      const beforeSha = l ? noteContentSha256(l.title, l.content) : null;
      const will = { recreate: !l, title: !l || l.title !== b.title, content: !l || l.content !== b.content };
      if (args.p_dry_run) {
        return { data: { id, dryRun: true, backup: { contentSha256: b.content_sha256, backedUpAt: null },
          current: { exists: Boolean(l), contentSha256: beforeSha }, willChange: will }, error: null };
      }
      if (!l && tables.vault_notes.some((row) => row.note_id === id)) return err('duplicate key value violates unique constraint', '23505');
      if (state.verifyFails) return err('RESTORE_VERIFY_FAILED');
      if (l) Object.assign(l, { title: b.title, content: b.content });
      else tables.vault_notes.push({ note_id: id, owner_id: owner, title: b.title, content: b.content });
      return { data: { id, ownerId: owner, restored: true, contentSha256: b.content_sha256,
        report: { backupVersion: { contentSha256: b.content_sha256, backedUpAt: null }, before: { exists: Boolean(l), contentSha256: beforeSha }, changed: will } }, error: null };
    },
  };
}

const original = {
  A: { note_id: A_NOTE, owner_id: USER_A, title: 'A 메모', content: 'A 내용' },
  B: { note_id: B_NOTE, owner_id: USER_B, title: 'B 메모', content: 'B 내용' },
  B2: { note_id: B_OTHER, owner_id: USER_B, title: 'B 메모 2', content: 'B 내용 2' },
};
const backupRow = (note) => ({ ...note, content_sha256: noteContentSha256(note.title, note.content) });
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
  state = { calls: [], audit: [], auditFails: false, failRpc: false, badReply: false, verifyFails: false, badReplyOwner: false };
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
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 200);
  const want = backupRow(original.B).content_sha256;
  assert.deepEqual(out.body, {
    id: B_NOTE, ownerId: USER_B, restored: true, contentSha256: want,
    preview: {
      backupVersion: { contentSha256: want, backedUpAt: null },
      current: { exists: true, contentSha256: noteContentSha256('변조됨', '변조된 내용') },
      willChange: { recreate: false, title: true, content: true },
    },
    report: {
      backupVersion: { contentSha256: want, backedUpAt: null },
      before: { exists: true, contentSha256: noteContentSha256('변조됨', '변조된 내용') },
      changed: { recreate: false, title: true, content: true },
    },
  });
  assert.deepEqual(Object.keys(out.body).sort(), ['contentSha256', 'id', 'ownerId', 'preview', 'report', 'restored']);
  assert.ok(!JSON.stringify(out.body).includes('변조된 내용'));
  const row = live(B_NOTE);
  assert.equal(row.note_id, B_NOTE); assert.equal(row.owner_id, USER_B);
  assert.equal(noteContentSha256(row.title, row.content), tables.vault_notes_backup[0].content_sha256);
  assert.equal(JSON.stringify([live(A_NOTE), live(B_OTHER), tables.vault_notes_backup]), before);
  assert.equal(out.headers.get('cache-control'), 'no-store');
  // 순서: 먼저 쓰기 없는 확인·미리보기, 그다음에 복원.
  assert.deepEqual(state.calls, ['rpc:restore_one_note:dry', 'rpc:restore_one_note:run']);
  assert.equal(out.body.preview.backupVersion.contentSha256, out.body.contentSha256);
  assert.equal(out.body.preview.willChange.content, true);
});

test('B가 삭제된 자기 메모 한 건을 복원: 같은 id·소유자로 다시 생기고 다른 행은 그대로', async () => {
  tables.vault_notes.splice(tables.vault_notes.indexOf(live(B_NOTE)), 1);
  const before = JSON.stringify([live(A_NOTE), live(B_OTHER)]);
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 200);
  assert.deepEqual(live(B_NOTE), { ...original.B });
  assert.equal(tables.vault_notes.length, 3);
  assert.equal(JSON.stringify([live(A_NOTE), live(B_OTHER)]), before);
});

test('이미 같은 메모를 복원해도 결과는 같다', async () => {
  const before = snapshotOf();
  assert.equal((await post(B_NOTE, asB)).status, 200);
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

test('같은 id의 행이 다른 소유자로 있으면 덮어쓰지 않고 404로 끝난다', async () => {
  live(B_NOTE).owner_id = USER_A;
  const before = snapshotOf();
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 404);
  assert.equal(snapshotOf(), before);
  assert.ok(logged.some((l) => l.includes('restore_owner_conflict')));
});

test('확인 단계가 틀리면 502로 알리고 메모는 한 글자도 바뀌지 않는다(되돌릴 쓰기가 없다)', async () => {
  state.verifyFails = true;
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 502); assert.deepEqual(out.body, { error: 'RESTORE_VERIFY_FAILED' });
  assert.equal(snapshotOf(), before);
  assert.ok(logged.some((l) => l.includes('restore_verify_failed')));
});

test('본문의 id는 어긋나면 멈추고, owner_id는 대상도 복원 여부도 바꾸지 못한다, role·맨 위 title·content는 읽지 않는다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const before = snapshotOf();
  const spoof = await post(B_NOTE, asB, { body: { id: A_NOTE } });
  assert.equal(spoof.status, 409); assert.deepEqual(spoof.body, { error: 'BACKUP_MISMATCH' });
  assert.equal(snapshotOf(), before);
  // 소유자 값(owner_id·userId)은 대상을 바꾸지도, 복원을 막지도 않는다: 복원은 로그인한 본인 소유의 사본 한 건뿐.
  const ownerSpoof = await post(B_NOTE, asB, { body: { owner_id: USER_A, userId: USER_A } });
  assert.equal(ownerSpoof.status, 200); assert.equal(live(B_NOTE).owner_id, USER_B); assert.deepEqual(live(A_NOTE), original.A);
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const out = await post(B_NOTE, asB, { body: { role: 'instructor', title: '끼워 넣기', content: 'x' } });
  assert.equal(out.status, 200);
  assert.equal(live(B_NOTE).owner_id, USER_B);
  assert.equal(live(B_NOTE).title, original.B.title);
  assert.deepEqual(live(A_NOTE), original.A);
});

test('로그인 없음 401, 가짜 토큰 401, POST가 아니면 405, 모양이 다른 id는 DB 없이 404', async () => {
  assert.equal((await post(B_NOTE, {})).status, 401);
  assert.equal((await post(B_NOTE, { authorization: 'Bearer nope' })).status, 401);
  const wrongMethod = { headers: new Map() };
  await service.handleRestore({ method: 'GET', headers: asB, url: `/api/notes/${B_NOTE}/restore` },
    { setHeader: () => {}, status: (c) => { wrongMethod.status = c; return { json: (b) => { wrongMethod.body = b; } }; } });
  assert.equal(wrongMethod.status, 405);
  for (const bad of ['not-a-uuid', 'export', '..']) assert.equal((await post(bad, asB)).status, 404);
  assert.deepEqual(state.calls, []);
});

test('DB 오류 응답과 로그에 키·메모 내용·소유자 ID가 없고, 성공 응답의 소유자는 본인 ID뿐이다', async () => {
  state.failRpc = true;
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 502);
  const text = JSON.stringify([out.body, logged]);
  for (const forbidden of [FAKE_KEY, 'B 내용', USER_B, USER_A, TOKEN_B]) assert.ok(!text.includes(forbidden), forbidden);
  state.failRpc = false; Object.assign(live(B_NOTE), { title: 'x' });
  const ok = await post(B_NOTE, asB);
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify([ok.body, logged]).includes('B 내용'));
  // 성공 응답의 소유자는 요청한 본인(토큰으로 확인된 사용자)의 ID 하나뿐이고, 로그에는 사용자 ID가 남지 않는다.
  assert.equal(ok.body.ownerId, USER_B);
  assert.ok(!JSON.stringify(ok.body).includes(USER_A));
  assert.ok(!JSON.stringify(logged).includes(USER_B));
});

test('DB가 엉뚱한 id·모양으로 답하면 그대로 전달하지 않고 502로 알린다', async () => {
  state.badReply = true;
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 502); assert.deepEqual(out.body, { error: 'RESTORE_VERIFY_FAILED' });
  assert.ok(logged.some((l) => l.includes('restore_bad_reply')));
});

test('복구 응답의 소유자가 확인된 사용자와 다르면 그대로 전달하지 않고 502로 알린다', async () => {
  state.badReply = true; state.badReplyOwner = true;
  const out = await post(B_NOTE, asB);
  assert.equal(out.status, 502); assert.deepEqual(out.body, { error: 'RESTORE_VERIFY_FAILED' });
  assert.ok(logged.some((l) => l.includes('restore_bad_reply')));
});

test('요청에 실린 사본 내용이 서버의 검증된 사본과 다르면 409로 멈추고 아무것도 쓰지 않는다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
  const before = snapshotOf();
  const wrongContent = await post(B_NOTE, asB, { body: { backup: { title: 'B 메모', content: '다른 내용' } } });
  assert.equal(wrongContent.status, 409); assert.deepEqual(wrongContent.body, { error: 'BACKUP_MISMATCH' });
  const wrongTitle = await post(B_NOTE, asB, { body: JSON.stringify({ snapshot: { title: '다른 제목' } }) });
  assert.equal(wrongTitle.status, 409); assert.deepEqual(wrongTitle.body, { error: 'BACKUP_MISMATCH' });
  assert.equal(snapshotOf(), before);
  assert.deepEqual(state.audit.map((row) => row.outcome), ['request_mismatch', 'request_mismatch']);
});

test('요청의 id가 주소와 다르거나 내용 값끼리 모순되면 DB를 부르지 않고 409로 멈춘다', async () => {
  const before = snapshotOf();
  const otherId = await post(B_NOTE, asB, { body: { id: B_OTHER } });
  const inconsistent = await post(B_NOTE, asB, { body: { backup: { content: 'x' }, expected: { content: 'y' } } });
  for (const out of [otherId, inconsistent]) { assert.equal(out.status, 409); assert.deepEqual(out.body, { error: 'BACKUP_MISMATCH' }); }
  assert.deepEqual(state.calls, []);
  assert.equal(snapshotOf(), before);
});

test('대조 값이 사본과 같거나 없거나 모양이 틀렸으면 정상 복원하고, 맨 위의 title·body는 읽지 않는다', async () => {
  const bodies = [
    { backup: { id: B_NOTE, ownerId: USER_B, title: 'B 메모', content: 'B 내용' } },
    { owner: 'B', id: 'not-a-uuid', backup: { owner_id: 7 } },
    { title: '엉뚱한 제목', body: '엉뚱한 본문' },
  ];
  for (const body of bodies) {
    Object.assign(live(B_NOTE), { title: '변조됨', content: '변조된 내용' });
    const out = await post(B_NOTE, asB, { body });
    assert.equal(out.status, 200, JSON.stringify(body)); assert.equal(out.body.restored, true);
    assert.equal(live(B_NOTE).title, 'B 메모'); assert.equal(live(B_NOTE).content, 'B 내용');
  }
});

test('감사 기록: 결과·요청 본문의 이름만 남고 내용·토큰·키는 없으며, 기록이 실패해도 응답은 같다', async () => {
  Object.assign(live(B_NOTE), { content: '변조된 내용' });
  const ok = await post(B_NOTE, asB, { body: { dryRun: false, backup: { title: 'B 메모' } }, headers: { ...asB, 'user-agent': 'probe/1.0' } });
  assert.equal(ok.status, 200);
  const miss = await post(B_OTHER, asB);
  assert.equal(miss.status, 404);
  assert.deepEqual(state.audit.map((row) => [row.outcome, row.status]), [['restored', 200], ['not_found', 404]]);
  assert.deepEqual(state.audit[0].body_keys, ['dryRun', 'backup', 'backup.title']);
  assert.equal(state.audit[0].had_pin, true); assert.equal(state.audit[0].user_agent, 'probe/1.0');
  assert.equal(state.audit[0].owner_id, USER_B); assert.equal(state.audit[0].note_id, B_NOTE);
  const text = JSON.stringify([state.audit, logged]);
  for (const forbidden of [FAKE_KEY, 'B 내용', '변조된 내용', TOKEN_B]) assert.ok(!text.includes(forbidden), forbidden);
  state.auditFails = true; Object.assign(live(B_NOTE), { content: '또 변조' });
  const again = await post(B_NOTE, asB);
  assert.equal(again.status, 200); assert.equal(live(B_NOTE).content, 'B 내용');
  assert.ok(logged.some((l) => l.includes('restore audit failed')));
  assert.ok(!logged.join('\n').includes(FAKE_KEY));
});

test('요청 본문 읽기(readPin): 이름은 정해진 것만, 모양 틀린 값은 무시, 맨 위 title·body는 안 읽음', () => {
  assert.deepEqual(readPin(null).ids, []);
  const pin = readPin({ id: B_NOTE.toUpperCase(), owner: USER_B, title: '위', body: '위', backup: { title: '사본', text: '내용' }, x: { title: '무시' } });
  assert.deepEqual(pin.ids, [B_NOTE]); assert.deepEqual(pin.owners, [USER_B]);
  assert.equal(pin.title, '사본'); assert.equal(pin.content, '내용');
  assert.deepEqual(pin.keys, ['id', 'owner', 'title', 'body', 'backup', 'x', 'backup.title', 'backup.text']);
});

test('dryRun: 아무것도 쓰지 않고 복원할 버전과 바뀔 항목만 보여 주며 원문은 없다', async () => {
  Object.assign(live(B_NOTE), { content: '변조된 내용' });
  const before = snapshotOf();
  const out = await post(B_NOTE, asB, { body: { dryRun: true } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, {
    id: B_NOTE, dryRun: true,
    backup: { contentSha256: backupRow(original.B).content_sha256, backedUpAt: null },
    current: { exists: true, contentSha256: noteContentSha256(original.B.title, '변조된 내용') },
    willChange: { recreate: false, title: false, content: true },
  });
  assert.equal(snapshotOf(), before);
  assert.deepEqual(state.calls, ['rpc:restore_one_note:dry']);
  assert.ok(!JSON.stringify(out.body).includes('변조된 내용'));
});

test('dryRun: 삭제된 메모는 "다시 만듦"으로 보이고, 사본 검증이 실패하면 미리보기도 멈춘다', async () => {
  tables.vault_notes.splice(tables.vault_notes.indexOf(live(B_NOTE)), 1);
  const gone = await post(B_NOTE, asB, { body: { dryRun: true } });
  assert.deepEqual(gone.body.willChange, { recreate: true, title: true, content: true });
  assert.deepEqual(gone.body.current, { exists: false, contentSha256: null });
  assert.equal(tables.vault_notes.length, 2);
  tables.vault_notes_backup[0].title = '사본 변조';
  const bad = await post(B_NOTE, asB, { body: { dryRun: true } });
  assert.equal(bad.status, 409);
  assert.equal(tables.vault_notes.length, 2);
});

test('dryRun이 true가 아니면(문자열 "true", 1 등) 실제로 복원한다', async () => {
  Object.assign(live(B_NOTE), { title: '변조됨' });
  const out = await post(B_NOTE, asB, { body: { dryRun: 'true' } });
  assert.equal(out.status, 200); assert.equal(out.body.restored, true);
  assert.equal(live(B_NOTE).title, original.B.title);
});
