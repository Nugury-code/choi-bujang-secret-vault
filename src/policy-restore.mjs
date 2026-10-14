// 10단계: 검증한 안전 정책 사본으로 "시험 정책"을 되돌리는 절차(미리보기 → 확인 코드 → 적용).
// 이 파일의 함수는 값만 돌려주고 파일을 쓰지 않는다. 파일 쓰기는 scripts/policy-restore.mjs가 맡는다.
// 되돌리는 대상은 시험 정책 상태(policy/test-policy.json의 testPolicy)뿐이다.
// 상태 문서의 다른 항목(예: 다른 서비스 규칙)과 감사 기록은 그대로 두고, 감사 기록에는 줄만 덧붙인다.
//
// 짐작(문서에 계약 없음): "시험 정책 상태 파일"의 위치·모양, 확인 코드 방식, 감사 줄 모양은 내가 정했다.
// 이 절차는 src/decider.mjs의 판정 코드를 바꾸지 않는다. 판정기는 코드의 규칙을 그대로 쓴다.
import { createHash } from 'node:crypto';
import { canonicalPolicy, planPolicyRestore, verifySnapshot } from './policy-diff.mjs';

export const STATE_FILE = 'policy/test-policy.json';
export const AUDIT_FILE = 'policy/restore-audit.log';

// 미리 본 변경 내용에 묶인 확인 코드. 사본이나 바뀔 항목이 달라지면 코드도 달라진다.
export function confirmCodeFor(plan) {
  if (!plan?.ok) return null;
  const body = JSON.stringify({ digest: plan.restoreVersion.digest, step: plan.step,
    ruleIds: plan.ruleIds, allowedRoutes: plan.allowedRoutes });
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

// 1단계: 실행 전 미리보기. 바뀔 항목과 확인 코드를 돌려준다. 아무것도 바꾸지 않는다.
export function previewRestore({ snapshot, current }) {
  const plan = planPolicyRestore({ snapshot, current });
  if (!plan.ok) return plan;
  return { ...plan, confirmCode: confirmCodeFor(plan) };
}

// 2단계: 확인 코드가 미리본 내용과 같을 때만 새 상태를 돌려준다.
// state: 시험 정책 상태 문서(testPolicy와 그 밖의 항목). auditLog: 지금까지의 감사 줄 배열.
export function applyRestore({ snapshot, state, confirmCode, now = () => new Date(), auditLog = [] }) {
  const verified = verifySnapshot(snapshot);
  if (!verified.ok) return { ok: false, code: verified.code, wrote: false };
  const current = state?.testPolicy;
  const plan = previewRestore({ snapshot: verified.snapshot, current });
  if (!plan.ok) return { ok: false, code: plan.code, wrote: false };
  if (typeof confirmCode !== 'string' || confirmCode !== plan.confirmCode) {
    return { ok: false, code: 'confirm_mismatch', wrote: false };
  }
  if (plan.identical) return { ok: true, noChange: true, plan, state, auditLog };
  const restored = JSON.parse(canonicalPolicy(verified.snapshot.policy));
  const entry = {
    at: now().toISOString(), action: 'policy_restore', label: verified.snapshot.label,
    fromDigest: createHash('sha256').update(canonicalPolicy(current)).digest('hex'),
    toDigest: verified.snapshot.digest, changeCount: plan.changeCount,
  };
  // testPolicy만 바꾸고 상태 문서의 다른 항목은 그대로 복사한다. 감사 기록은 줄만 덧붙인다.
  return { ok: true, noChange: false, plan, entry,
    state: { ...state, testPolicy: restored }, auditLog: [...auditLog, entry] };
}
