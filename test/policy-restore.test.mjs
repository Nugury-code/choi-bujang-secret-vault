import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide } from '../src/decider.mjs';
import { makeSnapshot } from '../src/policy-diff.mjs';
import { applyRestore, confirmCodeFor, previewRestore } from '../src/policy-restore.mjs';

const safe = { step: 9, ruleIds: ['starter.deny', 'device_registered', 'step_up_required', 'zone_rules'],
  allowedRoutes: ['GET /api/notes', 'POST /api/notes', 'GET /api/notes/:id'] };
const snapshot = makeSnapshot(safe, '시험 사본');
const tampered = { step: 9, ruleIds: ['starter.deny', 'device_registered', 'open_all'],
  allowedRoutes: ['GET /api/notes', 'GET /api/export', 'GET /api/notes/:id'] };
const state = () => ({ testPolicy: JSON.parse(JSON.stringify(tampered)),
  serviceRules: { threatIntel: ['keep_me'], ai: { limit: 5 } } });
const fixedNow = () => new Date('2026-10-13T00:00:00.000Z');

test('미리보기는 바뀔 항목과 확인 코드를 주고 아무것도 바꾸지 않는다', () => {
  const s = state(); const before = JSON.stringify([s, snapshot]);
  const p = previewRestore({ snapshot, current: s.testPolicy });
  assert.equal(p.ok, true);
  assert.deepEqual(p.ruleIds, { restoreAdds: ['step_up_required', 'zone_rules'], restoreRemoves: ['open_all'] });
  assert.deepEqual(p.allowedRoutes, { restoreAdds: ['POST /api/notes'], restoreRemoves: ['GET /api/export'] });
  assert.match(p.confirmCode, /^[0-9a-f]{12}$/u);
  assert.equal(JSON.stringify([s, snapshot]), before);
});

test('확인 코드 없음·틀림이면 적용하지 않는다', () => {
  for (const code of [undefined, null, '', 'deadbeef0000']) {
    const r = applyRestore({ snapshot, state: state(), confirmCode: code, now: fixedNow });
    assert.equal(r.ok, false); assert.equal(r.code, 'confirm_mismatch'); assert.equal(r.wrote, false);
  }
});

test('사본이 없거나 검증 실패면 적용하지 않는다', () => {
  const code = 'aaaaaaaaaaaa';
  assert.equal(applyRestore({ snapshot: null, state: state(), confirmCode: code }).code, 'snapshot_missing');
  const bad = { ...snapshot, digest: '0'.repeat(64) };
  assert.equal(applyRestore({ snapshot: bad, state: state(), confirmCode: code }).code, 'snapshot_digest_mismatch');
  assert.equal(applyRestore({ snapshot, state: { testPolicy: { step: 1 } }, confirmCode: code }).code, 'current_policy_unreadable');
});

test('맞는 확인 코드면 시험 정책만 되돌리고 다른 서비스 규칙과 감사 기록은 보존한다', () => {
  const s = state(); const audit = [{ at: '2026-10-12T00:00:00.000Z', action: 'old_event' }];
  const code = previewRestore({ snapshot, current: s.testPolicy }).confirmCode;
  const r = applyRestore({ snapshot, state: s, confirmCode: code, now: fixedNow, auditLog: audit });
  assert.equal(r.ok, true); assert.equal(r.noChange, false);
  assert.deepEqual(r.state.testPolicy, JSON.parse(JSON.stringify({ allowedRoutes: [...safe.allowedRoutes].sort(),
    ruleIds: [...safe.ruleIds].sort(), step: 9 })));
  assert.deepEqual(r.state.serviceRules, { threatIntel: ['keep_me'], ai: { limit: 5 } });
  assert.deepEqual(r.auditLog.slice(0, 1), audit);
  assert.equal(r.auditLog.length, 2);
  assert.equal(r.entry.action, 'policy_restore'); assert.equal(r.entry.toDigest, snapshot.digest);
  assert.equal(r.entry.at, '2026-10-13T00:00:00.000Z');
  assert.deepEqual(Object.keys(r.entry).sort(), ['action', 'at', 'changeCount', 'fromDigest', 'label', 'toDigest']);
  assert.equal(JSON.stringify(s.testPolicy), JSON.stringify(tampered)); // 들어온 상태는 그대로
  // 되돌린 뒤 다시 미리보기하면 차이가 없다
  assert.equal(previewRestore({ snapshot, current: r.state.testPolicy }).identical, true);
});

test('이미 같으면 적용 없이 끝나고 감사 줄도 늘지 않는다', () => {
  const s = { testPolicy: JSON.parse(JSON.stringify(safe)) };
  const code = previewRestore({ snapshot, current: s.testPolicy }).confirmCode;
  const r = applyRestore({ snapshot, state: s, confirmCode: code, auditLog: [] });
  assert.equal(r.ok, true); assert.equal(r.noChange, true); assert.equal(r.auditLog.length, 0);
});

test('미리본 뒤 상태가 달라지면 같은 확인 코드로 적용되지 않는다', () => {
  const s = state(); const code = previewRestore({ snapshot, current: s.testPolicy }).confirmCode;
  s.testPolicy.ruleIds.push('another_open');
  assert.equal(applyRestore({ snapshot, state: s, confirmCode: code }).code, 'confirm_mismatch');
  assert.equal(confirmCodeFor({ ok: false }), null);
});

test('되돌린 뒤에도 판정기는 같다: A 자기 메모는 허용, 공지 수정·모르는 경로는 거부', async () => {
  const s = state(); const code = previewRestore({ snapshot, current: s.testPolicy }).confirmCode;
  assert.equal(applyRestore({ snapshot, state: s, confirmCode: code, now: fixedNow }).ok, true);
  const { normal } = fixtureRequests();
  const own = await decide(normal);
  assert.equal(own.decision, 'allow');
  const notice = await decide({ ...normal, method: 'PUT', path: '/notice/n1', route: 'PUT /notice/:id' });
  assert.equal(notice.decision, 'deny');
  const odd = await decide({ ...normal, path: '/notes/export', route: 'GET /notes/:id' });
  assert.equal(odd.decision, 'deny');
  const unregistered = await decide({ ...normal, deviceRegistered: false });
  assert.equal(unregistered.decision, 'deny');
});
