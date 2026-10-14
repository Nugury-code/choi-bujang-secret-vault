import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { RULE_IDS } from '../src/decider.mjs';
import { describePlan, readCurrentPolicy, readSnapshotFile } from '../src/policy-diff.mjs';
import { applyRestore, AUDIT_FILE, previewRestore, STATE_FILE } from '../src/policy-restore.mjs';

// 기본은 미리보기만 한다. 적용하려면: npm run policy:restore -- --apply <확인 코드>
const root = new URL('../', import.meta.url);
const at = rel => fileURLToPath(new URL(rel, root));
function readJson(rel) { try { return JSON.parse(readFileSync(at(rel), 'utf8')); } catch { return null; } }

const config = readJson('aleph.config.json');
// 시험 정책 상태 파일이 있으면 그것을, 없으면 코드의 현재 정책(RULE_IDS·설정)을 현재 정책으로 본다.
const stateDoc = existsSync(at(STATE_FILE)) ? readJson(STATE_FILE) : null;
const state = stateDoc ?? { testPolicy: readCurrentPolicy({ ruleIds: RULE_IDS, config }) };
const snapshot = readSnapshotFile(root);

const args = process.argv.slice(2);
const applyAt = args.indexOf('--apply');
const code = applyAt >= 0 ? args[applyAt + 1] : null;

const preview = previewRestore({ snapshot, current: state.testPolicy });
for (const line of describePlan(preview)) console.log(line);
if (!preview.ok) { process.exitCode = 1; }
else if (applyAt < 0) {
  console.log(preview.identical ? '되돌릴 것이 없습니다.' : `적용하려면: npm run policy:restore -- --apply ${preview.confirmCode}`);
} else {
  const result = applyRestore({ snapshot, state, confirmCode: code,
    auditLog: [] });
  if (!result.ok) { console.log(`중단: 적용하지 않았습니다. 이유 코드: ${result.code}`); process.exitCode = 1; }
  else if (result.noChange) console.log('이미 같아 적용하지 않았습니다.');
  else {
    mkdirSync(dirname(at(STATE_FILE)), { recursive: true });
    const tmp = at(STATE_FILE) + '.tmp';
    writeFileSync(tmp, JSON.stringify(result.state, null, 2) + '\n'); renameSync(tmp, at(STATE_FILE));
    appendFileSync(at(AUDIT_FILE), JSON.stringify(result.entry) + '\n');
    console.log('적용했습니다. 시험 정책 상태와 감사 줄 한 개만 바뀌었습니다.');
  }
}
