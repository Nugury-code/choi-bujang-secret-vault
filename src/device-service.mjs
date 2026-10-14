import { createHash, createPublicKey, verify } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { clientIp, createMemoryLimiter, hashKey, tooMany } from './rate-limit.mjs';
import { createLoginVerifier } from './verify-login.mjs';

// 11단계: 기기 승인 요청 API. POST /api/device 하나입니다.
// - 로그인 토큰은 src/verify-login.mjs(도우미)로만 검사하고, 사용자 ID는 도우미가 확인한 값만 씁니다.
// - 브라우저는 자기 기기 공개 키(자물쇠 쪽)와, 그 개인 키로 "지금 이 요청"에 한 서명을 보냅니다. 개인 키는 오지 않습니다.
//   서버는 서명을 검사해서 "이 공개 키의 주인이 지금 요청한 것"임을 확인합니다(남의 공개 키를 베껴 보내도 서명이 안 맞아 거부).
// - 승인 여부는 DB 표 device_requests의 status가 정합니다. 요청은 항상 'pending'으로만 들어가고(supabase/007_device_requests.sql이
//   서버 역할에게 status를 정할 권한을 주지 않음), 'approved'로 바꾸는 일은 주인이 Supabase에서 직접 합니다.
//   이 API는 승인 버튼(요청)만으로 권한을 주지 않으며, 응답의 status는 DB에 있는 값 그대로입니다.
// - 이 API의 응답은 { status } 하나뿐입니다. 공개 키·지문·사용자 ID·토큰은 돌려주거나 로그에 남기지 않습니다.
// - 서명 시각 허용 폭(60초)과 요청 횟수 한도(IP 120, 사용자 30 / 60초), 서명 글자 모양(ECDSA P-256, SHA-256)은 내가 정한 값: 짐작.

export const DEVICE_LIMITS = { ip: { limit: 120, window: 60 }, user: { limit: 30, window: 60 } };
export const SIGNATURE_WINDOW_MS = 60_000;
export const PROOF_LABEL = 'byte-back-device-request';
const B64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const STATUSES = new Set(['pending', 'approved', 'rejected']);

const defaultCreateDb = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function send(response, status, body) {
  return response.status(status).json(body);
}

function deny(response, status, body, reason) {
  console.error(`device: denied ${reason}`);
  return send(response, status, body);
}

function parseBody(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

// 서명 대상 글자: 라벨, 공개 키 지문, 서명 시각(밀리초)을 줄바꿈으로 이어 붙입니다.
export function proofText(fingerprint, signedAt) {
  return `${PROOF_LABEL}\n${fingerprint}\n${signedAt}`;
}

// 본문의 공개 키(SPKI, base64)와 서명을 검사하고 지문을 돌려줍니다. 잘못되면 null.
export function readDeviceProof(body, nowMs = Date.now()) {
  const { publicKey, signature, signedAt } = body ?? {};
  if (typeof publicKey !== 'string' || publicKey.length < 40 || publicKey.length > 400 || !B64.test(publicKey)) return null;
  if (typeof signature !== 'string' || signature.length < 40 || signature.length > 200 || !B64.test(signature)) return null;
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowMs - signedAt) > SIGNATURE_WINDOW_MS) return null;
  try {
    const der = Buffer.from(publicKey, 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    const fingerprint = createHash('sha256').update(der).digest('hex');
    const ok = verify('sha256', Buffer.from(proofText(fingerprint, signedAt), 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'));
    return ok ? { fingerprint, publicKey } : null;
  } catch {
    return null;
  }
}

export function createDeviceService({ loginConfig = config, verifierOptions = {}, createDb = defaultCreateDb, memory = createMemoryLimiter(), now = Date.now } = {}) {
  let cached = null;
  function verifierFor(secretKey) {
    if (!cached || cached.secretKey !== secretKey) {
      cached = {
        secretKey,
        verify: createLoginVerifier({ config: loginConfig, supabaseSecretKey: secretKey, ...verifierOptions }),
      };
    }
    return cached.verify;
  }

  // 순서: 메서드 → 서버 설정 → IP별 횟수 제한 → 로그인 토큰 → 사용자별 횟수 제한 → 본문·서명 검사 → DB.
  async function handleDevice(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error('device: server settings missing');
      return send(response, 500, { error: 'SERVER_NOT_CONFIGURED' });
    }
    const ipLimit = memory(`device:ip:${hashKey(key, 'device-ip', clientIp(request))}`,
      DEVICE_LIMITS.ip.limit, DEVICE_LIMITS.ip.window * 1000);
    if (!ipLimit.allowed) return tooMany(response, ipLimit.retryAfter);
    let verifyLogin;
    try {
      verifyLogin = verifierFor(key);
    } catch (error) {
      console.error('device: login check unavailable', error?.message ?? 'unknown');
      return send(response, 500, { error: 'LOGIN_CHECK_UNAVAILABLE' });
    }
    const identity = await verifyLogin(request.headers?.authorization);
    if (!identity) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return send(response, 401, { error: 'UNAUTHORIZED' });
    }
    const userLimit = memory(`device:user:${hashKey(key, 'device-user', identity.userId)}`,
      DEVICE_LIMITS.user.limit, DEVICE_LIMITS.user.window * 1000);
    if (!userLimit.allowed) return tooMany(response, userLimit.retryAfter);
    const proof = readDeviceProof(parseBody(request), now());
    if (!proof) return deny(response, 400, { error: 'INVALID_DEVICE_PROOF' }, 'bad_proof');
    try {
      const db = createDb(url, key);
      const lookup = () => db.from('device_requests').select('status')
        .eq('owner_id', identity.userId).eq('fingerprint', proof.fingerprint).maybeSingle();
      let { data, error } = await lookup();
      if (error) throw error;
      if (!data) {
        const inserted = await db.from('device_requests')
          .insert({ owner_id: identity.userId, fingerprint: proof.fingerprint, public_key: proof.publicKey });
        // 같은 기기가 동시에 두 번 요청해 이미 줄이 생겼으면(23505) 다시 읽습니다.
        if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
        ({ data, error } = await lookup());
        if (error) throw error;
      }
      const status = STATUSES.has(data?.status) ? data.status : null;
      if (!status) throw new Error('unknown_status');
      return send(response, 200, { status });
    } catch (error) {
      console.error('device: request failed', error?.code ?? 'unknown');
      return send(response, 502, { error: 'DEVICE_REQUEST_FAILED' });
    }
  }

  return { handleDevice };
}
