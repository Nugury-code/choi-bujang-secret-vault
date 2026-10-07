import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIp, createMemoryLimiter, durableHit, hashKey, tooMany } from '../src/rate-limit.mjs';

test('메모리 제한: 한도까지 허용하고 넘으면 막고, 창이 지나면 다시 센다', () => {
  let clock = 1_000_000;
  const hit = createMemoryLimiter({ now: () => clock });
  for (let n = 1; n <= 3; n += 1) assert.equal(hit('k', 3, 60_000).allowed, true, `${n}번째`);
  const blocked = hit('k', 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(hit('other', 3, 60_000).allowed, true, '다른 키는 따로 센다');
  clock += 30_000;
  assert.equal(hit('k', 3, 60_000).retryAfter, 30);
  clock += 30_001;
  assert.equal(hit('k', 3, 60_000).allowed, true, '창이 지나면 처음부터');
});

test('메모리 제한: 키가 너무 많이 쌓이면 지난 것부터 정리해 메모리가 계속 늘지 않는다', () => {
  let clock = 0;
  const hit = createMemoryLimiter({ now: () => clock });
  for (let n = 0; n < 5001; n += 1) hit(`old-${n}`, 1, 1000);
  clock = 5000;
  hit('fresh', 1, 1000);
  assert.equal(hit('old-1', 1, 1000).allowed, true, '지난 창의 키는 정리돼 새로 센다');
  for (let n = 0; n < 6000; n += 1) hit(`live-${n}`, 1, 10_000_000);
  assert.equal(hit('fresh', 1, 1000).allowed, true);
});

test('clientIp: Vercel이 채우는 헤더를 우선하고, 이상한 값은 unknown', () => {
  assert.equal(clientIp({ headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' } }), '203.0.113.7');
  assert.equal(clientIp({ headers: { 'x-real-ip': '198.51.100.9' } }), '198.51.100.9');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '2001:DB8::1, 10.0.0.1' } }), '2001:db8::1');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ['192.0.2.1', '10.0.0.1'] } }), '192.0.2.1');
  for (const headers of [{}, { 'x-real-ip': 'not an ip!' }, { 'x-real-ip': '' }, { 'x-real-ip': '<script>' }]) assert.equal(clientIp({ headers }), 'unknown');
  assert.equal(clientIp({}), 'unknown');
  assert.equal(clientIp(undefined), 'unknown');
});

test('hashKey: 같은 입력은 같은 값, 비밀·범위·값이 다르면 다른 값이고 원본 값이 들어 있지 않다', () => {
  const a = hashKey('secret', 'login-ip', '203.0.113.7');
  assert.equal(a, hashKey('secret', 'login-ip', '203.0.113.7'));
  assert.notEqual(a, hashKey('other', 'login-ip', '203.0.113.7'));
  assert.notEqual(a, hashKey('secret', 'login-email', '203.0.113.7'));
  assert.notEqual(a, hashKey('secret', 'login-ip', '203.0.113.8'));
  assert.match(a, /^[0-9a-f]{40}$/u);
});

test('durableHit: rate_limit_hit 결과를 해석하고, 오류·잘못된 응답·rpc 없음은 null(제한을 걸지 않음)', async () => {
  const sent = [];
  const ok = (data, error = null) => ({ rpc: async (name, args) => { sent.push({ name, args }); return { data, error }; } });
  assert.deepEqual(await durableHit(ok([{ allowed: true, retry_after: 5 }]), 'key', 10, 60), { allowed: true, retryAfter: 5 });
  assert.deepEqual(await durableHit(ok({ allowed: false, retry_after: 0 }), 'key', 10, 60), { allowed: false, retryAfter: 60 });
  assert.deepEqual(sent[0], { name: 'rate_limit_hit', args: { p_key: 'key', p_window_seconds: 60, p_limit: 10 } });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(await durableHit(ok(null, { code: '42883', message: 'secret detail' }), 'key', 10, 60), null);
    assert.equal(await durableHit(ok([{ nope: 1 }]), 'key', 10, 60), null);
    assert.equal(await durableHit({ rpc: async () => { throw new Error('boom secret'); } }, 'key', 10, 60), null);
    assert.equal(await durableHit({}, 'key', 10, 60), null);
    assert.equal(await durableHit(undefined, 'key', 10, 60), null);
  } finally {
    console.error = original;
  }
  assert.ok(errors.every((line) => !line.includes('secret')), '오류 문구는 코드만 남긴다');
});

test('tooMany: 429와 Retry-After', () => {
  const out = {};
  tooMany({ setHeader: (key, value) => { out[key] = value; }, status: (code) => ({ json: (body) => { out.status = code; out.body = body; } }) }, 12);
  assert.equal(out.status, 429);
  assert.equal(out['Retry-After'], '12');
  assert.deepEqual(out.body, { error: 'RATE_LIMITED' });
});
