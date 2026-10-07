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
