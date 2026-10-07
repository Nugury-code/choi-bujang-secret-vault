import { createHmac } from 'node:crypto';

// 요청 횟수 제한. 두 겹으로 겁니다.
// 1) 메모리 제한: 서버 함수 인스턴스 안에서만 세는 값이라 DB를 부르지 않고 빠릅니다. 인스턴스가 여러 개 떠 있으면
//    각자 따로 세므로 "정확한 제한"이 아니라 폭주를 일찍 끊는 첫 방어선입니다.
// 2) DB 제한: Supabase의 rate_limit_hit() 함수(supabase/003_rate_limits.sql)로 모든 인스턴스가 같은 숫자를 봅니다.
//    로그인·토큰 갱신·메모 쓰기처럼 중요한 곳에 씁니다. DB 제한이 오류가 나면(함수가 아직 없거나 DB가 잠깐 안 될 때)
//    메모리 제한만 남기고 계속 처리하며, 오류 코드만 로그에 남깁니다(요청은 막지 않는 쪽으로 실패).
// 제한 대상 이름(IP·이메일)은 서버 키로 해시한 값만 저장하고 원래 값은 저장하지 않습니다.

const MAX_KEYS = 5000;

export function clientIp(request) {
  const headers = request?.headers ?? {};
  // Vercel이 직접 채우는 값이 먼저입니다(브라우저가 보낸 값으로 덮어쓰지 못합니다).
  const raw = headers['x-vercel-forwarded-for'] ?? headers['x-real-ip'] ?? headers['x-forwarded-for'];
  const first = String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',')[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/u.test(first) ? first.toLowerCase() : 'unknown';
}

export function hashKey(secret, scope, value) {
  return createHmac('sha256', String(secret ?? '')).update(`${scope}\n${value}`).digest('hex').slice(0, 40);
}

export function createMemoryLimiter({ now = Date.now } = {}) {
  const buckets = new Map();
  return function hit(key, limit, windowMs) {
    const time = now();
    if (buckets.size > MAX_KEYS) {
      for (const [name, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(name);
      if (buckets.size > MAX_KEYS) buckets.clear();
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
  };
}

// db: createDb(url, key)로 만든 Supabase 클라이언트. rpc가 없거나 실패하면 DB 제한은 건너뜁니다.
export async function durableHit(db, key, limit, windowSeconds) {
  if (typeof db?.rpc !== 'function') return null;
  try {
    const { data, error } = await db.rpc('rate_limit_hit', {
      p_key: key, p_window_seconds: windowSeconds, p_limit: limit,
    });
    if (error) {
      console.error('rate-limit: db check failed', error.code ?? 'unknown');
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') return null;
    return { allowed: row.allowed, retryAfter: Math.max(1, Number(row.retry_after) || windowSeconds) };
  } catch {
    console.error('rate-limit: db check unavailable');
    return null;
  }
}

export function tooMany(response, retryAfter) {
  response.setHeader('Retry-After', String(retryAfter));
  return response.status(429).json({ error: 'RATE_LIMITED' });
}
