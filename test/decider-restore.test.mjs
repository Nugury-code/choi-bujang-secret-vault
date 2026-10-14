import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../src/decider.mjs';

// 10단계: 복구 경로 POST /notes/:id/restore 를 판정기가 어떻게 가리는지 보는 가상 요청 연습입니다(심판 판정이 아닙니다).
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERIFIED = { verified: true, authAgeSeconds: 30 };
const base = {
  schema: 'aleph.decision.v1', requestId: '11111111-1111-4111-8111-111111111111', classId: 'c', projectId: 'p',
  subjectId: 's', deviceId: '0123456789abcdef', service: 'notes', queryLength: 0, querySha256: '0'.repeat(64),
  at: '2026-10-13T00:00:00.000Z', policyRevision: 'r1', deviceRegistered: true,
  stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
  signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 12 },
};
const ask = (method, path, route, over = {}) => decide({ ...base, method, path, route, ...over });

test('복구는 본인 확인을 마친 등록 기기의 POST 한 건만 허용한다', async () => {
  for (const prefix of ['', '/api']) {
    const route = `POST ${prefix}/notes/:id/restore`;
    assert.equal((await ask('POST', `${prefix}/notes/${ID}/restore`, route, { stepUp: VERIFIED })).decision, 'allow');
    const again = await ask('POST', `${prefix}/notes/${ID}/restore`, route);
    assert.deepEqual([again.decision, again.reasonCode], ['step_up', 'step_up_required']);
  }
  assert.equal((await ask('POST', `/notes/${ID}/restore`, 'POST /notes/:id/restore', { stepUp: { verified: true, authAgeSeconds: 901 } })).decision, 'step_up');
  assert.equal((await ask('POST', `/notes/${ID}/restore`, 'POST /notes/:id/restore', { stepUp: VERIFIED, deviceRegistered: false })).reasonCode, 'device_not_registered');
});

test('복구 모양이 아니거나 이상한 모양이면 거부한다', async () => {
  const ok = { stepUp: VERIFIED };
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await ask(method, `/notes/${ID}/restore`, `${method} /notes/:id/restore`, ok)).decision, 'deny');
  }
  const bad = [
    ['/notes/all/restore', 'POST /notes/:id/restore'], ['/notes/abc/restore', 'POST /notes/:id/restore'],
    [`/notes/${ID}/restore/x`, 'POST /notes/:id/restore'], [`/notes/${ID}/restore`, 'POST /notes/:id'],
    [`/notes/${ID}`, 'POST /notes/:id/restore'], ['/notes/%2e%2e/restore', 'POST /notes/:id/restore'],
    [`/instructor/notes/${ID}/restore`, 'POST /notes/:id/restore'], ['/notes/restore', 'POST /notes/restore'],
  ];
  for (const [path, route] of bad) assert.equal((await ask('POST', path, route, ok)).decision, 'deny', path);
  assert.equal((await ask('POST', `/notices/${ID}/restore`, 'POST /notices/:id/restore', ok)).reasonCode, 'forbidden_resource');
});

test('8단계 규칙은 그대로다: 읽기·수정 허용, 추가·삭제·목록 거부', async () => {
  assert.equal((await ask('GET', `/notes/${ID}`, 'GET /notes/:id')).decision, 'allow');
  assert.equal((await ask('PUT', `/notes/${ID}`, 'PUT /notes/:id')).decision, 'allow');
  assert.equal((await ask('DELETE', `/notes/${ID}`, 'DELETE /notes/:id')).decision, 'deny');
  assert.equal((await ask('POST', '/notes', 'POST /notes')).decision, 'deny');
  assert.equal((await ask('GET', '/notes', 'GET /notes')).decision, 'deny');
});
