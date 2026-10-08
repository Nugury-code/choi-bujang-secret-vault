// 보너스 「웹 주입 공격」: 차단 후보(block)만 거부 규칙으로 만들어 판정기 앞에 거는 연결입니다.
// 실행: node xdr/web-injection/connect-decider.mjs  (경보를 다시 흘려 규칙·알림 로그·막힘/통과를 보여 줍니다)
//
// 연결 방식과 한계(솔직히 적어 둡니다)
// - src/decider.mjs 와 그 규칙(RULE_IDS)은 고치지 않습니다. 이 파일이 판정기 앞에서 요청을 먼저 봅니다.
// - 판정기 요청 계약(docs/DECIDER_REQUEST.md)에는 출발 주소가 없습니다. 그래서 주소는 요청 안이 아니라
//   `source.srcip` 로 요청 밖에서 따로 받습니다. 실제 엔진이 주소를 이렇게 건네주는지는 확인하지 못했습니다(미확인).
// - 'xdr_web_injection_block' 이유 코드와 규칙 이름은 운영 등록부에 등록되지 않았습니다. docs/DECIDER_REQUEST.md 는
//   이유 코드가 맞지 않으면 엔진이 접근을 허용하지 않는다고 적고 있어 거부 쪽으로 실패할 것으로 보이지만,
//   실제 엔진에서 확인하지는 못했습니다(미확인).
// - 규칙은 xdr/web-injection/deny-rules.json 에 저장합니다(로그인 보너스의 xdr/deny-rules.json 과 섞이지 않게 따로 둡니다). 알림 로그 xdr/alerts.log 는 두 보너스가 함께 씁니다. 이 저장소에서 판정기 호출 경로를 바꾸지 않았으므로, 이 파일을 읽어
//   요청 앞에서 확인하는 일(loadRules + evaluateRequest)은 엔진이 실제로 이 모듈을 부를 때에야 일어납니다(미연결).
// - 만료 시각은 경보 시각이 아니라 규칙을 만든 시각 기준이고, 아직 유효한 같은 경보의 규칙은 다시 만들거나 늘리지 않습니다.
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide as decideAlert } from './decide.mjs';
import { extractAlert } from './read-alerts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = join(here, '..', 'fixtures', 'web-injection.json');
const LOG_FILE = join(here, '..', 'alerts.log');
const RULES_FILE = join(here, 'deny-rules.json');

// 거부 규칙의 유효 시간. 공유 주소의 정상 사용자가 오래 막히지 않도록 짧게 잡았습니다(근거 있는 값이 아닌 선택).
export const DENY_TTL_MS = 30 * 60 * 1000;
export const DENY_REASON_CODE = 'xdr_web_injection_block';

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ALERT_ID = /^[A-Za-z0-9._-]{1,64}$/;

// 사내·루프백·링크로컬·멀티캐스트 같은 주소는 정상 사용자가 있을 수 있어 규칙으로 만들지 않습니다(문서용 대역은 허용).
function isBlockableAddress(address) {
  if (!IPV4.test(address ?? '')) return false;
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

// 로그 한 줄에 들어가는 글자: 줄바꿈·제어문자는 공백으로, '='는 ':'로 바꿔 다른 칸처럼 보이는 글자를 막습니다.
const oneLine = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/=/g, ':').trim();

// 판정 결과 목록 → 거부 규칙. block 만 규칙이 되고, 같은 주소에 정상(record) 이벤트가 있으면 규칙을 만들지 않습니다.
export function buildBlockRules(items, { now, ttlMs = DENY_TTL_MS }) {
  const normalAddresses = new Set(items.filter((item) => item.action === 'record' && item.srcip).map((item) => item.srcip));
  const rules = [];
  const skipped = [];
  for (const item of items) {
    if (item.action !== 'block') continue;
    if (!isBlockableAddress(item.srcip) || !ALERT_ID.test(item.alertId ?? '')) {
      skipped.push({ alertId: item.alertId, reason: 'invalid_address_or_id' });
    } else if (normalAddresses.has(item.srcip)) {
      skipped.push({ alertId: item.alertId, reason: 'shared_with_normal_event' });
    } else {
      rules.push({
        id: `xdr.web-injection.deny.${item.alertId}`,
        effect: 'deny',
        srcip: item.srcip,
        evidenceAlertId: item.alertId,
        confidence: item.confidence,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
      });
    }
  }
  return { rules, skipped };
}

// 요청 하나를 판정기 앞에서 확인합니다. 살아 있는 거부 규칙에 걸리면 deny, 아니면 판정기(delegate)에 그대로 넘깁니다.
export async function evaluateRequest(request, source, rules, { delegate, now }) {
  const srcip = source !== null && typeof source === 'object' ? source.srcip : null;
  const live = IPV4.test(srcip ?? '')
    ? rules.filter((rule) => rule.srcip === srcip && Date.parse(rule.expiresAt) > now)
    : [];
  if (live.length > 0 && request && typeof request.requestId === 'string') {
    const rule = live.reduce((a, b) => (Date.parse(b.expiresAt) > Date.parse(a.expiresAt) ? b : a));
    return {
      blocked: true,
      rule,
      response: {
        schema: 'aleph.decision.v1',
        requestId: request.requestId,
        decision: 'deny',
        reasonCode: DENY_REASON_CODE,
        ruleIds: [rule.id],
      },
    };
  }
  return { blocked: false, rule: null, response: await delegate(request) };
}

// block·alert 판정을 xdr/alerts.log 에 한 줄씩 쌓습니다. 이미 적힌 경보 번호는 다시 쓰지 않습니다.
export async function appendAlertLog(items, rules, skipped, { now, logFile = LOG_FILE }) {
  let existing = '';
  try {
    existing = await readFile(logFile, 'utf8');
  } catch {
    existing = '';
  }
  const seen = new Set([...existing.matchAll(/\baction=(block|alert) alert=([A-Za-z0-9._-]+)/g)].map((match) => `${match[1]}:${match[2]}`));
  const ruleByAlert = new Map(rules.map((rule) => [rule.evidenceAlertId, rule]));
  const skippedByAlert = new Map(skipped.map((entry) => [entry.alertId, entry.reason]));
  const lines = [];
  for (const item of items) {
    if ((item.action !== 'block' && item.action !== 'alert') || !ALERT_ID.test(item.alertId ?? '') || seen.has(`${item.action}:${item.alertId}`)) continue;
    seen.add(`${item.action}:${item.alertId}`);
    const rule = ruleByAlert.get(item.alertId);
    const note = item.action === 'alert' ? 'rule=none'
      : rule ? `expires=${rule.expiresAt}` : `rule=skipped:${skippedByAlert.get(item.alertId) ?? 'unknown'}`;
    lines.push([
      new Date(now).toISOString(), `action=${item.action}`, `alert=${item.alertId}`,
      `srcip=${IPV4.test(item.srcip ?? '') ? item.srcip : '-'}`, `confidence=${item.confidence}`, note,
      `reason=${oneLine(item.reason)}`,
    ].join(' '));
  }
  if (lines.length > 0) {
    await mkdir(dirname(logFile), { recursive: true });
    await appendFile(logFile, `${lines.join('\n')}\n`, 'utf8');
  }
  return { written: lines.length, existing: seen.size - lines.length };
}

function isRule(value) {
  return value !== null && typeof value === 'object' && value.effect === 'deny'
    && typeof value.id === 'string' && IPV4.test(value.srcip ?? '') && ALERT_ID.test(value.evidenceAlertId ?? '')
    && Number.isFinite(Date.parse(value.expiresAt));
}

// 저장된 규칙 중 아직 유효한 것만 읽습니다. 파일이 없거나 깨졌으면 빈 목록(규칙 없음)입니다.
export async function loadRules(rulesFile = RULES_FILE, now = Date.now()) {
  try {
    const parsed = JSON.parse(await readFile(rulesFile, 'utf8'));
    return (Array.isArray(parsed?.rules) ? parsed.rules : []).filter((rule) => isRule(rule) && Date.parse(rule.expiresAt) > now);
  } catch {
    return [];
  }
}

// 유효한 기존 규칙은 그대로 두고(만료를 늘리지 않음) 새 규칙만 더해 파일에 씁니다. 만료된 규칙은 지웁니다.
export async function saveRules(fresh, { now, rulesFile = RULES_FILE }) {
  const kept = await loadRules(rulesFile, now);
  const keptAlerts = new Set(kept.map((rule) => rule.evidenceAlertId));
  const rules = [...kept, ...fresh.filter((rule) => !keptAlerts.has(rule.evidenceAlertId))];
  const body = `${JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'web-injection', rules }, null, 2)}\n`;
  await mkdir(dirname(rulesFile), { recursive: true });
  const temp = `${rulesFile}.${process.pid}.tmp`;
  await writeFile(temp, body, 'utf8');
  await rename(temp, rulesFile);
  return rules;
}

function virtualRequest() {
  return {
    schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'class_fixture', projectId: 'project_fixture',
    subjectId: 'learner_fixture', deviceId: 'a'.repeat(16), service: 'notes', method: 'GET', path: '/notes/demo',
    route: 'GET /notes/:id', queryLength: 0, querySha256: '0'.repeat(64), at: new Date().toISOString(),
    policyRevision: 1, deviceRegistered: true, stepUp: { verified: false, authAgeSeconds: null },
    recentEvents: [], signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
  };
}

// 경보 묶음을 판정 → 규칙 만들기 → 로그 쓰기 → 같은 경보의 주소로 가상 요청을 다시 흘리기.
export async function replay({ fixture, delegate, now = Date.now(), logFile = LOG_FILE, rulesFile = RULES_FILE, decideFn = decideAlert }) {
  const items = [];
  for (const alert of fixture.alerts) {
    const row = extractAlert(alert);
    const decision = await decideFn(alert);
    items.push({
      alertId: alert && typeof alert.id === 'string' ? alert.id : '',
      srcip: row.srcip, action: decision.action, confidence: decision.confidence, reason: decision.reason,
    });
  }
  const { rules: fresh, skipped } = buildBlockRules(items, { now });
  const rules = await saveRules(fresh, { now, rulesFile });
  const log = await appendAlertLog(items, rules, skipped, { now, logFile });

  const ruleAlerts = new Set(rules.map((rule) => rule.evidenceAlertId));
  const outcomes = [];
  for (const item of items) {
    const result = await evaluateRequest(virtualRequest(), { srcip: item.srcip }, rules, { delegate, now });
    outcomes.push({ ...item, blocked: result.blocked, shouldBlock: ruleAlerts.has(item.alertId) });
  }
  const blocked = outcomes.filter((outcome) => outcome.blocked).length;
  const passed = outcomes.length - blocked;
  // 명확한 공격(규칙이 된 block)만 막히고, 그 밖의 경보는 모두 판정기로 넘어가야 합니다.
  const ok = outcomes.every((outcome) => outcome.blocked === outcome.shouldBlock)
    && outcomes.every((outcome) => outcome.action !== 'block' || outcome.shouldBlock || skipped.some((entry) => entry.alertId === outcome.alertId));
  return { items, rules, skipped, log, outcomes, blocked, passed, ok };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const fixture = JSON.parse(await readFile(FIXTURE_FILE, 'utf8'));
    if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'web-injection' || !Array.isArray(fixture.alerts)) {
      throw new Error('web-injection 경보 묶음이 아닙니다.');
    }
    const { decide: deciderDecide } = await import(pathToFileURL(join(here, '..', '..', 'src', 'decider.mjs')).href);
    const result = await replay({ fixture, delegate: deciderDecide });
    console.log(`거부 규칙 ${result.rules.length}개 (유효 ${DENY_TTL_MS / 60000}분, 보류 ${result.skipped.length}개)`);
    for (const rule of result.rules) console.log(`  ${rule.id} | ${rule.srcip} | 근거 경보 ${rule.evidenceAlertId} | 만료 ${rule.expiresAt}`);
    console.log(`규칙 파일 xdr/web-injection/deny-rules.json 에 ${result.rules.length}개를 저장했습니다.`);
    console.log(`알림 로그 xdr/alerts.log: 새로 쓴 줄 ${result.log.written} / 이미 있던 줄 ${result.log.existing}`);
    console.log(`다시 흘림: 막힘 ${result.blocked}건 (거부 규칙) / 판정기로 넘김 ${result.passed}건`);
    console.log(result.ok ? '결과: 명확한 공격만 막히고 나머지는 판정기로 넘어갔습니다.' : '결과: 불일치');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
