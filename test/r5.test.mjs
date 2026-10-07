import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 1,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 1,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('build identity records the step from the config', () => {
  assert.equal(deploymentIdentity(env, { ...config, step: 2 }).step, 2);
  assert.throws(() => deploymentIdentity(env, { ...config, step: 0 }));
  assert.throws(() => deploymentIdentity(env, { ...config, step: 13 }));
});

test('first attack check reads public data.json without credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const [result] = await runAttackChecks(config);
    assert.equal(requestUrl, 'https://student-defense.vercel.app/data.json');
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /확인 표시가 보임/u);
    globalThis.fetch = async () => new Response('<html>not the data</html>', { status: 200 });
    const [failed] = await runAttackChecks(config);
    assert.match(failed.observed, /보이지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('step 2 attack check records the static file and the anonymous API without note text', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).endsWith('/data.json')) return new Response(JSON.stringify({ notes: [] }), { status: 200 });
      return new Response(JSON.stringify({ notes: [{ title: 'SECRET_TITLE', content: 'SECRET_BODY' }] }), { status: 200 });
    };
    const results = await runAttackChecks({ ...config, step: 2 });
    assert.deepEqual(urls, ['https://student-defense.vercel.app/data.json', 'https://student-defense.vercel.app/api/notes']);
    assert.deepEqual(results.map(item => Object.keys(item).sort()), [['attackId', 'expected', 'observed'], ['attackId', 'expected', 'observed']]);
    assert.match(results[0].observed, /메모 0건, 확인 표시 없음/u);
    assert.match(results[1].observed, /메모 1건/u);
    assert.ok(!JSON.stringify(results).includes('SECRET_'));
    globalThis.fetch = async (url) => String(url).endsWith('/api/notes')
      ? new Response(JSON.stringify([{ id: 'x', title: 'SECRET_TITLE', body: 'SECRET_BODY' }]), { status: 200 })
      : new Response(JSON.stringify({ notes: [] }), { status: 200 });
    const [, openApi] = await runAttackChecks({ ...config, step: 2 });
    assert.match(openApi.observed, /메모 1건을 내려 줌/u);
    assert.ok(!JSON.stringify(openApi).includes('SECRET_'));
    globalThis.fetch = async () => new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [] }), { status: 200 });
    const [leaked] = await runAttackChecks({ ...config, step: 2 });
    assert.match(leaked.observed, /확인 표시가 보임/u);
    globalThis.fetch = async (url) => String(url).endsWith('/api/notes')
      ? new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
      : new Response(JSON.stringify({ notes: [] }), { status: 200 });
    const [, denied] = await runAttackChecks({ ...config, step: 2 });
    assert.match(denied.observed, /자료 없이 거절됨 \(HTTP 401\)/u);
    globalThis.fetch = async () => { throw new Error('network'); };
    const [failed] = await runAttackChecks({ ...config, step: 2 });
    assert.match(failed.observed, /확인하지 못함/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('step 3 attack check sends only requests that need no login and records status codes, never tokens or note text', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const step3 = {
    ...config,
    step: 3,
    identityProvider: {
      issuer: 'https://project.supabase.co/auth/v1', audience: 'authenticated',
      jwksUrl: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
    },
  };
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null });
      if (String(url).endsWith('/data.json')) return new Response(JSON.stringify({ notes: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
    };
    const results = await runAttackChecks(step3);
    assert.equal(results.length, 8);
    assert.deepEqual(results.map(item => Object.keys(item).sort()).filter(keys => keys.join() !== 'attackId,expected,observed'), []);
    assert.deepEqual(results.map(item => item.attackId), ['static_data_has_no_notes', 'anonymous_note_read', 'anonymous_note_create',
      'anonymous_note_update', 'anonymous_note_delete', 'forged_token_read', 'expired_token_read', 'other_service_token_read']);
    for (const item of results.slice(1)) assert.match(item.observed, /자료 없이 거절됨 \(HTTP 401\)/u);
    assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST', 'PUT', 'DELETE', 'GET', 'GET', 'GET']);
    assert.deepEqual(calls.map(call => Boolean(call.auth)), [false, false, false, false, false, true, true, true]);
    assert.ok(calls.slice(1).every(call => call.url.startsWith('https://student-defense.vercel.app/api/notes')));
    const text = JSON.stringify(results);
    assert.ok(!/Bearer|eyJ|sb_secret_|@/u.test(text));
    for (const call of calls.filter(item => item.auth)) assert.ok(!text.includes(call.auth.slice(7)));

    globalThis.fetch = async (url) => (String(url).endsWith('/data.json')
      ? new Response(JSON.stringify({ notes: [] }), { status: 200 })
      : new Response(JSON.stringify([{ id: 'x', title: 'SECRET_TITLE', body: 'SECRET_BODY' }]), { status: 200 }));
    const open = await runAttackChecks(step3);
    assert.match(open[1].observed, /막히지 않고 성공함 \(HTTP 200\)/u);
    assert.match(open[6].observed, /진짜 서명된 만료 토큰은 미실행/u);
    assert.ok(!JSON.stringify(open).includes('SECRET_'));

    globalThis.fetch = async () => { throw new Error('network'); };
    const failed = await runAttackChecks(step3);
    assert.match(failed[2].observed, /확인하지 못함/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('step 4 attack check keeps the login-free requests and records the A/B owner check as not run, without tokens or note text', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const step4 = {
    ...config,
    step: 4,
    identityProvider: {
      issuer: 'https://project.supabase.co/auth/v1', audience: 'authenticated',
      jwksUrl: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
    },
  };
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null });
      if (String(url).endsWith('/data.json')) return new Response(JSON.stringify({ notes: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
    };
    const results = await runAttackChecks(step4);
    assert.equal(results.length, 9);
    assert.equal(calls.length, 8, '미실행 항목은 요청을 보내지 않습니다');
    assert.deepEqual(results.map(item => Object.keys(item).sort()).filter(keys => keys.join() !== 'attackId,expected,observed'), []);
    assert.deepEqual(results.map(item => item.attackId), ['static_data_has_no_notes', 'anonymous_note_read', 'anonymous_note_create',
      'anonymous_note_update', 'anonymous_note_delete', 'forged_token_read', 'expired_token_read', 'other_service_token_read',
      'cross_owner_access']);
    for (const item of results.slice(1, 8)) assert.match(item.observed, /자료 없이 거절됨 \(HTTP 401\)/u);
    assert.match(results[8].observed, /^미실행/u);
    assert.ok(results.every(item => item.expected.length <= 300 && item.observed.length <= 300));
    const text = JSON.stringify(results);
    assert.ok(!/Bearer|eyJ|sb_secret_|@/u.test(text));
    for (const call of calls.filter(item => item.auth)) assert.ok(!text.includes(call.auth.slice(7)));

    globalThis.fetch = async (url) => (String(url).endsWith('/data.json')
      ? new Response(JSON.stringify({ notes: [] }), { status: 200 })
      : new Response(JSON.stringify([{ id: 'x', title: 'SECRET_TITLE', body: 'SECRET_BODY' }]), { status: 200 }));
    const open = await runAttackChecks(step4);
    assert.match(open[1].observed, /막히지 않고 성공함 \(HTTP 200\)/u);
    assert.match(open[8].observed, /^미실행/u);
    assert.ok(!JSON.stringify(open).includes('SECRET_'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
