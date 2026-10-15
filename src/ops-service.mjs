import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import policySnapshot from '../policy/safe-policy.snapshot.json' with { type: 'json' };
import { RULE_IDS } from './decider.mjs';
import { verifySnapshot } from './policy-diff.mjs';
import { createLoginVerifier } from './verify-login.mjs';

// 12단계: 탈환 작전실 요약. GET /api/ops 하나이며 읽기만 합니다.
// 네 가지 요약마다 status가 있습니다. observed = 이 서버가 이번 요청에서 직접 읽은 것, not_run = 이 서버가 읽을 곳이 없어 실행하지 않은 것.
// - 판정기 규칙: src/decider.mjs의 RULE_IDS (observed)
// - 탐지 사건, 회수 상태: 이 서버는 탐지 사건을 받거나 저장하지 않고 접속 회수를 실행하지도 않아 값을 만들지 않고 not_run
// - 복구 버전: 정책 사본(verifySnapshot으로 검증한 단계·지문 앞 12자리)과, 복원 감사 기록 restore_audit의 로그인한 사용자 본인의 최근 줄
//   결과별 수는 화면에 보이는 그 줄들에서 센 값이라 목록과 항상 맞습니다.
// - 메모 제목·본문, 이메일, 사용자 ID, 토큰은 응답에 없고 메모 번호는 앞 8자리만 있습니다.
// 이름(status 값, 칸 이름), 최근 줄 수 10, 가린 뒤 보이는 자리 8은 내가 정한 값: 짐작.
export const RECENT = 10;
export const MASK_CHARS = 8;

const defaultCreateDb = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export function maskId(value) {
  return typeof value === 'string' && value ? `${value.slice(0, MASK_CHARS)}…` : null;
}

export function summarizeAudit(rows) {
  const recent = rows.map((row) => ({ at: row.at, noteId: maskId(row.note_id), outcome: row.outcome, status: row.status }));
  const byOutcome = {};
  for (const row of recent) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  return { status: 'observed', total: recent.length, byOutcome, recent };
}

export function summarizePolicySnapshot(raw) {
  const verified = verifySnapshot(raw);
  if (!verified.ok) return { status: 'not_run' };
  return { status: 'observed', step: verified.snapshot.policy.step, digest: verified.snapshot.digest.slice(0, 12) };
}

export function createOpsService({ loginConfig = config, verifierOptions = {}, createDb = defaultCreateDb, snapshot = policySnapshot } = {}) {
  let cached = null;
  function verifierFor(secretKey) {
    if (!cached || cached.secretKey !== secretKey) {
      cached = { secretKey, verify: createLoginVerifier({ config: loginConfig, supabaseSecretKey: secretKey, ...verifierOptions }) };
    }
    return cached.verify;
  }

  async function handleOps(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error('ops: server settings missing');
      return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
    }
    let identity;
    try {
      identity = await verifierFor(key)(request.headers?.authorization);
    } catch (error) {
      console.error('ops: login check unavailable', error?.message ?? 'unknown');
      return response.status(500).json({ error: 'LOGIN_CHECK_UNAVAILABLE' });
    }
    if (!identity) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }
    let audit;
    try {
      const { data, error } = await createDb(url, key).from('restore_audit')
        .select('at, note_id, outcome, status').eq('owner_id', identity.userId)
        .order('at', { ascending: false }).limit(RECENT);
      if (error) throw error;
      audit = summarizeAudit(data ?? []);
    } catch (error) {
      console.error('ops: audit read failed', error?.code ?? 'unknown');
      audit = { status: 'not_run' };
    }
    return response.status(200).json({
      rules: { status: 'observed', ruleIds: [...RULE_IDS] },
      detection: { status: 'not_run' },
      revocation: { status: 'not_run' },
      recovery: { policySnapshot: summarizePolicySnapshot(snapshot), audit },
    });
  }

  return { handleOps };
}
