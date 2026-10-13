import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { diffPolicy, describePlan, makeSnapshot, planPolicyRestore, policyDigest, verifySnapshot } from '../src/policy-diff.mjs';

const base = { step: 9, ruleIds: ['starter.deny', 'device_registered', 'zone_rules'], allowedRoutes: ['GET /api/notes', 'POST /api/notes'] };
const snap = () => makeSnapshot(base, '시험 사본');

test('사본이 없으면 중단', () => {
  for (const s of [null, undefined]) {
    const p = planPolicyRestore({ snapshot: s, current: base });
    assert.equal(p.ok, false); assert.equal(p.code, 'snapshot_missing');
  }
});

test('검증 실패는 모두 중단', () => {
  const good = snap();
  const bad = {
    snapshot_not_json: '{없음',
    snapshot_bad_shape: { ...good, extra: 1 },
    snapshot_unknown_version: { ...good, snapshotVersion: 2 },
    snapshot_bad_label: { ...good, label: '' },
    snapshot_bad_policy: { ...good, policy: { ...good.policy, step: 99 } },
    snapshot_bad_digest: { ...good, digest: 'abc' },
    snapshot_digest_mismatch: { ...good, policy: { ...good.policy, ruleIds: [...good.policy.ruleIds, 'zone_rules2'] } },
    snapshot_secret_shape: { ...good, label: 'a@b.c' },
  };
  for (const [code, value] of Object.entries(bad)) {
    const p = planPolicyRestore({ snapshot: value, current: base });
    assert.equal(p.ok, false, code); assert.equal(p.code, code); assert.equal(p.willChange, false);
  }
  const rawBad = planPolicyRestore({ snapshot: JSON.stringify({ ...good, label: 'Bearer abcdefghij' }), current: base });
  assert.equal(rawBad.code, 'snapshot_secret_shape');
});

test('현재 정책을 못 읽으면 중단', () => {
  assert.equal(planPolicyRestore({ snapshot: snap(), current: { step: 9 } }).code, 'current_policy_unreadable');
});

test('같으면 변경 없음, 지문은 순서와 무관', () => {
  const p = planPolicyRestore({ snapshot: snap(), current: { ...base, ruleIds: [...base.ruleIds].reverse() } });
  assert.equal(p.ok, true); assert.equal(p.identical, true); assert.equal(p.changeCount, 0);
  assert.equal(policyDigest(base), policyDigest({ ...base, allowedRoutes: [...base.allowedRoutes].reverse() }));
});

test('복원할 버전과 변경 범위가 실행 전에 보임', () => {
  const current = { step: 10, ruleIds: ['starter.deny', 'device_registered', 'evil_open'],
    allowedRoutes: ['GET /api/notes', 'GET /api/export'] };
  const p = planPolicyRestore({ snapshot: snap(), current });
  assert.equal(p.ok, true); assert.equal(p.willChange, false);
  assert.equal(p.restoreVersion.label, '시험 사본');
  assert.deepEqual(p.ruleIds, { restoreAdds: ['zone_rules'], restoreRemoves: ['evil_open'] });
  assert.deepEqual(p.allowedRoutes, { restoreAdds: ['POST /api/notes'], restoreRemoves: ['GET /api/export'] });
  assert.deepEqual(p.step, { current: 10, restored: 9 });
  assert.equal(p.changeCount, 5);
  const text = describePlan(p).join('\n');
  assert.match(text, /복원할 버전: 시험 사본/); assert.match(text, /변경 범위: 5건/);
  assert.match(text, /규칙 사라짐: evil_open/); assert.match(text, /아무 것도 바꾸지 않습니다/);
});

test('중단 안내에는 이유 코드만 있고 정책을 바꾸지 않았다고 알림', () => {
  const text = describePlan(planPolicyRestore({ snapshot: null, current: base })).join('\n');
  assert.match(text, /중단/); assert.match(text, /snapshot_missing/); assert.match(text, /바뀌지 않았습니다/);
});

test('들어온 값을 바꾸지 않음', () => {
  const current = JSON.parse(JSON.stringify(base)); const s = snap(); const before = JSON.stringify([current, s]);
  planPolicyRestore({ snapshot: s, current }); diffPolicy(s.policy, current);
  assert.equal(JSON.stringify([current, s]), before);
});

test('저장소에 올라간 사본이 검증을 통과하고 현재 정책과 맞음', async () => {
  const root = new URL('../', import.meta.url);
  const raw = readFileSync(new URL('policy/safe-policy.snapshot.json', root), 'utf8');
  assert.equal(verifySnapshot(raw).ok, true);
  const { RULE_IDS } = await import('../src/decider.mjs');
  const cfg = JSON.parse(readFileSync(new URL('aleph.config.json', root), 'utf8'));
  const p = planPolicyRestore({ snapshot: raw, current: { step: cfg.step, ruleIds: [...RULE_IDS], allowedRoutes: cfg.allowedRoutes } });
  assert.equal(p.ok, true);
  assert.ok(existsSync(new URL('policy/safe-policy.snapshot.json', root)));
});
