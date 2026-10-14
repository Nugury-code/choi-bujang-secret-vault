import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import policySnapshot from '../policy/safe-policy.snapshot.json' with { type: 'json' };
import { decide, RULE_IDS } from '../src/decider.mjs';
import { createNotesService } from '../src/notes-service.mjs';
import { applyRestore, previewRestore } from '../src/policy-restore.mjs';

// 10단계 프롬프트 46의 확인 문구: "정책을 되돌린 뒤에도 B의 A 자료 요청은 다시 거부되고, A의 정상 요청은 유지되어야 합니다."
// 이 시험은 (1) 변조된 시험 정책을 검증한 사본으로 되돌리고 (2) 되돌린 정책이 실제 판정기·설정과 같은 규칙·경로를 가리키는지 보고
// (3) 판정기가 A의 정상 요청은 허용·금지 요청은 거부하는지, (4) 자료 API가 B의 A 메모 요청을 거부하고 A의 요청은 되는지 봅니다.
// 심판 판정이 아니라 내가 만든 가상 요청 시험입니다.
const tampered = { step: 9, ruleIds: ['starter.deny', 'open_all'], allowedRoutes: ['GET /api/notes', 'GET /api/export'] };
const stateDoc = { testPolicy: tampered, serviceRules: { other: ['keep'] } };

test('변조된 시험 정책을 검증한 사본으로 되돌리면, 되돌린 정책이 실제 판정기·설정이 쓰는 규칙·경로와 같다', () => {
  const code = previewRestore({ snapshot: policySnapshot, current: tampered }).confirmCode;
  const done = applyRestore({ snapshot: policySnapshot, state: stateDoc, confirmCode: code, auditLog: [{ old: 1 }] });
  assert.equal(done.ok, true);
  const restored = done.state.testPolicy;
  assert.deepEqual(done.state.serviceRules, { other: ['keep'] });
  assert.deepEqual(done.auditLog[0], { old: 1 });
  assert.ok(restored.ruleIds.every((id) => RULE_IDS.includes(id)), '되돌린 규칙이 판정기에 실제로 있어야 함');
  assert.ok(!restored.ruleIds.includes('open_all'));
  assert.ok(restored.allowedRoutes.every((route) => config.allowedRoutes.includes(route)), '되돌린 경로가 설정의 허용 경로 안에 있어야 함');
  assert.ok(!restored.allowedRoutes.includes('GET /api/export'));
});

const base = {
  schema: 'aleph.decision.v1', requestId: '11111111-1111-4111-8111-111111111111', classId: 'c', projectId: 'p',
  subjectId: 's', deviceId: '0123456789abcdef', service: 'notes', queryLength: 0, querySha256: '0'.repeat(64),
  at: '2026-10-13T00:00:00.000Z', policyRevision: 'r1', deviceRegistered: true,
  stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
  signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 12 },
};
const ID = '11111111-1111-4111-8111-111111111111';

test('판정기: 등록 기기의 정상 자기 메모 읽기는 허용, 내보내기 같은 기능 경로와 미등록 기기는 거부', async () => {
  const ok = await decide({ ...base, method: 'GET', path: `/notes/${ID}`, route: 'GET /notes/:id' });
  assert.equal(ok.decision, 'allow');
  const exp = await decide({ ...base, method: 'GET', path: '/notes/export', route: 'GET /notes/:id' });
  assert.equal(exp.decision, 'deny');
  const dev = await decide({ ...base, deviceRegistered: false, method: 'GET', path: `/notes/${ID}`, route: 'GET /notes/:id' });
  assert.equal(dev.reasonCode, 'device_not_registered');
});

// 자료 API: B가 A의 메모를 읽기·수정·삭제하면 404, A의 요청은 그대로 됩니다.
const USER_A = '0b8c1d52-3a41-4e7e-9d3a-6f2f7c1a9b10';
const USER_B = '5d2f6c8e-91aa-4c1b-8a55-3c0e2d7f4b21';
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const tokenFor = (marker) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ iss: config.identityProvider.issuer, marker })}.c2ln`;
const TOKENS = new Map([[tokenFor('a'), USER_A], [tokenFor('b'), USER_B]]);
const fakeSupabase = { auth: { async getClaims(token) {
  const sub = TOKENS.get(token);
  const exp = Math.floor(Date.now() / 1000) + 600;
  return sub ? { data: { claims: { iss: config.identityProvider.issuer, aud: config.identityProvider.audience, role: 'authenticated', sub, exp } }, error: null }
    : { data: null, error: new Error('bad') };
} } };

function fakeDb(rows) {
  return { rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }), from() {
    const filters = []; let op = 'select'; let values;
    const exec = () => {
      const hit = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, values)); return { data: hit.map((r) => ({ ...r })).slice(0, 1)[0] ?? null, error: null }; }
      if (op === 'delete') { hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return { data: hit.map((r) => ({ ...r })), error: null }; }
      return { data: hit[0] ? { ...hit[0] } : null, error: null };
    };
    const q = { select() { return q; }, update(v) { op = 'update'; values = v; return q; }, delete() { op = 'delete'; return q; },
      eq(k, v) { filters.push([k, v]); return q; }, maybeSingle: async () => exec(), then: (res, rej) => Promise.resolve(exec()).then(res, rej) };
    return q;
  } };
}
const call = async (service, handler, request) => {
  const out = { headers: new Map() };
  const response = { setHeader: (k, v) => out.headers.set(k.toLowerCase(), v), status: (c) => { out.status = c; return { json: (b) => { out.body = b; } }; } };
  await service[handler](request, response);
  return out;
};

test('자료 API: B의 A 메모 읽기·수정·삭제는 거부되고 A의 자기 메모 요청은 유지된다', async () => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.test';
  process.env.SUPABASE_SECRET_KEY = 'fake-key-for-test-only';
  const rows = [{ note_id: ID, owner_id: USER_A, title: 'A 메모', content: 'A 내용' }];
  const service = createNotesService({ verifierOptions: { supabaseClient: fakeSupabase }, createDb: () => fakeDb(rows) });
  const asA = { authorization: `Bearer ${tokenFor('a')}` };
  const asB = { authorization: `Bearer ${tokenFor('b')}` };
  const url = `/api/notes/${ID}`;
  const before = JSON.stringify(rows);
  const originalError = console.error; console.error = () => {};
  try {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const out = await call(service, 'handleItem', { method, headers: asB, url, query: { id: ID }, body: { title: 'x', body: 'y' } });
      assert.equal(out.status, 404, method);
    }
    assert.equal(JSON.stringify(rows), before);
    const mine = await call(service, 'handleItem', { method: 'GET', headers: asA, url, query: { id: ID } });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.id, ID);
  } finally { console.error = originalError; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; }
});
