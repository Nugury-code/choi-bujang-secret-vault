// 10단계: "검증된 안전 정책 사본"과 "현재 시험 정책"의 차이만 보여 주는 읽기 전용 기능.
// 이 파일은 아무 것도 쓰거나 바꾸지 않는다. 운영 정책(src/decider.mjs, aleph.config.json)은 읽기만 한다.
//
// 짐작(문서에 계약이 없음): 10단계 카드와 docs/에는 "정책 사본"의 파일 형식이 없다.
// 그래서 여기서는 정책을 { step, ruleIds, allowedRoutes } 세 가지로 보고,
// 사본을 policy/safe-policy.snapshot.json 한 파일(Git에 올려도 되는 공개 값만)로 가정했다.
// 검증은 (1) 모양 검사 (2) 사본 안의 sha256 지문 재계산 (3) 비밀값 모양 검사다.
// 한계: 지문이 사본 파일 안에 같이 들어 있어서, 파일과 지문을 함께 바꾼 사람을 막지는 못한다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SNAPSHOT_FILE = 'policy/safe-policy.snapshot.json';
const SNAPSHOT_KEYS = ['digest', 'label', 'policy', 'snapshotVersion'];
const POLICY_KEYS = ['allowedRoutes', 'ruleIds', 'step'];
const RULE_ID = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/u;
const ROUTE = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[A-Za-z0-9_:\-./]{0,120}$/u;
const SECRET_SHAPE = /@|Bearer\s|eyJ[A-Za-z0-9_-]{8,}|sb_secret|service_role|-----BEGIN/u;

function sortedUnique(list) { return [...new Set(list)].sort(); }

// 같은 정책이면 항상 같은 글자열이 되도록 항목 순서를 고정한다.
export function canonicalPolicy(policy) {
  return JSON.stringify({
    allowedRoutes: sortedUnique(policy.allowedRoutes),
    ruleIds: sortedUnique(policy.ruleIds),
    step: policy.step,
  });
}

export function policyDigest(policy) {
  return createHash('sha256').update(canonicalPolicy(policy)).digest('hex');
}

// 사본 파일을 만들 때 쓰는 함수(파일을 쓰지는 않고 값만 돌려준다).
export function makeSnapshot(policy, label) {
  return { snapshotVersion: 1, label, policy: JSON.parse(canonicalPolicy(policy)), digest: policyDigest(policy) };
}

function isPolicyShape(p) {
  return p && typeof p === 'object' && !Array.isArray(p)
    && Object.keys(p).sort().join(',') === POLICY_KEYS.join(',')
    && Number.isInteger(p.step) && p.step >= 1 && p.step <= 12
    && Array.isArray(p.ruleIds) && p.ruleIds.length > 0 && p.ruleIds.length <= 64
    && p.ruleIds.every(id => typeof id === 'string' && RULE_ID.test(id))
    && Array.isArray(p.allowedRoutes) && p.allowedRoutes.length <= 64
    && p.allowedRoutes.every(r => typeof r === 'string' && ROUTE.test(r));
}

// 결과: { ok:true, snapshot } 또는 { ok:false, code } — 실패하면 호출한 쪽이 중단해야 한다.
export function verifySnapshot(raw) {
  if (raw === null || raw === undefined) return { ok: false, code: 'snapshot_missing' };
  let snap = raw;
  if (typeof raw === 'string') {
    if (SECRET_SHAPE.test(raw)) return { ok: false, code: 'snapshot_secret_shape' };
    try { snap = JSON.parse(raw); } catch { return { ok: false, code: 'snapshot_not_json' }; }
  }
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)
      || Object.keys(snap).sort().join(',') !== SNAPSHOT_KEYS.join(',')) {
    return { ok: false, code: 'snapshot_bad_shape' };
  }
  if (snap.snapshotVersion !== 1) return { ok: false, code: 'snapshot_unknown_version' };
  if (typeof snap.label !== 'string' || snap.label.length === 0 || snap.label.length > 80) {
    return { ok: false, code: 'snapshot_bad_label' };
  }
  if (!isPolicyShape(snap.policy)) return { ok: false, code: 'snapshot_bad_policy' };
  if (typeof snap.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(snap.digest)) {
    return { ok: false, code: 'snapshot_bad_digest' };
  }
  if (snap.digest !== policyDigest(snap.policy)) return { ok: false, code: 'snapshot_digest_mismatch' };
  if (SECRET_SHAPE.test(JSON.stringify(snap))) return { ok: false, code: 'snapshot_secret_shape' };
  return { ok: true, snapshot: snap };
}

function setDiff(from, to) {
  const f = new Set(from); const t = new Set(to);
  return { added: sortedUnique(to).filter(x => !f.has(x)), removed: sortedUnique(from).filter(x => !t.has(x)) };
}

// 사본(복원할 쪽)을 기준으로 현재 정책과 비교한다. 아무 것도 바꾸지 않는다.
export function diffPolicy(snapshotPolicy, currentPolicy) {
  const rules = setDiff(currentPolicy.ruleIds, snapshotPolicy.ruleIds);
  const routes = setDiff(currentPolicy.allowedRoutes, snapshotPolicy.allowedRoutes);
  const step = currentPolicy.step === snapshotPolicy.step ? null
    : { current: currentPolicy.step, restored: snapshotPolicy.step };
  const changeCount = rules.added.length + rules.removed.length
    + routes.added.length + routes.removed.length + (step ? 1 : 0);
  // restoreAdds: 복원하면 다시 생기는 항목, restoreRemoves: 복원하면 사라지는 항목
  return { changeCount, identical: changeCount === 0, step,
    ruleIds: { restoreAdds: rules.added, restoreRemoves: rules.removed },
    allowedRoutes: { restoreAdds: routes.added, restoreRemoves: routes.removed } };
}

// 실행 전에 보여 줄 계획. 사본이 없거나 검증에 실패하면 { ok:false }로 중단한다.
export function planPolicyRestore({ snapshot, current }) {
  const verified = verifySnapshot(snapshot);
  if (!verified.ok) return { ok: false, code: verified.code, willChange: false };
  if (!isPolicyShape(current)) return { ok: false, code: 'current_policy_unreadable', willChange: false };
  const snap = verified.snapshot;
  return { ok: true, willChange: false, restoreVersion: { label: snap.label, snapshotVersion: snap.snapshotVersion,
    digest: snap.digest, step: snap.policy.step }, ...diffPolicy(snap.policy, current) };
}

// 현재 시험 정책을 읽는다(읽기 전용). RULE_IDS는 src/decider.mjs, 나머지는 aleph.config.json 값.
export function readCurrentPolicy({ ruleIds, config }) {
  return { step: config?.step, ruleIds: [...ruleIds], allowedRoutes: [...(config?.allowedRoutes ?? [])] };
}

export function readSnapshotFile(root) {
  try { return readFileSync(new URL(SNAPSHOT_FILE, root), 'utf8'); } catch { return null; }
}

// 화면에 보여 줄 글. 값은 정책 이름뿐이고 비밀값은 없다.
export function describePlan(plan) {
  if (!plan.ok) {
    return ['중단: 안전 정책 사본을 확인하지 못했습니다.', `이유 코드: ${plan.code}`, '정책은 바뀌지 않았습니다(이 기능은 읽기만 합니다).'];
  }
  const v = plan.restoreVersion; const out = [];
  out.push(`복원할 버전: ${v.label} (단계 ${v.step}, 사본 형식 ${v.snapshotVersion}, 지문 ${v.digest.slice(0, 12)})`);
  if (plan.identical) {
    out.push('변경 범위: 없음(현재 시험 정책이 사본과 같습니다).');
  } else {
    out.push(`변경 범위: ${plan.changeCount}건`);
    if (plan.step) out.push(`- 단계 ${plan.step.current} → ${plan.step.restored}`);
    for (const r of plan.ruleIds.restoreAdds) out.push(`- 규칙 되살림: ${r}`);
    for (const r of plan.ruleIds.restoreRemoves) out.push(`- 규칙 사라짐: ${r}`);
    for (const r of plan.allowedRoutes.restoreAdds) out.push(`- 허용 경로 되살림: ${r}`);
    for (const r of plan.allowedRoutes.restoreRemoves) out.push(`- 허용 경로 사라짐: ${r}`);
  }
  out.push('실행 전 미리보기입니다. 이 기능은 아무 것도 바꾸지 않습니다.');
  return out;
}
