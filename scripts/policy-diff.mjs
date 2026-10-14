import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RULE_IDS } from '../src/decider.mjs';
import { describePlan, planPolicyRestore, readCurrentPolicy, readSnapshotFile } from '../src/policy-diff.mjs';

// 읽기 전용: 사본과 현재 시험 정책의 차이를 보여 주기만 한다. 파일·정책을 쓰지 않는다.
const root = new URL('../', import.meta.url);
let config = null;
try { config = JSON.parse(readFileSync(fileURLToPath(new URL('aleph.config.json', root)), 'utf8')); } catch { /* 아래에서 중단 */ }
const plan = planPolicyRestore({
  snapshot: readSnapshotFile(root),
  current: readCurrentPolicy({ ruleIds: RULE_IDS, config }),
});
for (const line of describePlan(plan)) console.log(line);
process.exitCode = plan.ok ? 0 : 1;
