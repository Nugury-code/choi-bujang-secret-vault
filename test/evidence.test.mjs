import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { collectEvidence, NOT_SENT, plannedRequests, renderTable } from '../scripts/evidence-table.mjs';

const GOOD_TOKEN = 'good-token-for-test';
let server;
let baseUrl;
let mode = 'safe';
let seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null });
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'x-vercel-id': `icn1::test-${seen.length}` }); res.end(JSON.stringify(body)); };
    if (req.url === '/' || req.url === '/aleph.json') return send(200, {});
    if (req.url === '/data.json') return send(200, { notes: mode === 'leaky-data' ? [{ id: 'x' }] : [] });
    if (req.url.startsWith('/api/')) {
      if (mode === 'open') return send(200, []);
      if (req.headers.authorization === `Bearer ${GOOD_TOKEN}` && req.method === 'GET' && req.url === '/api/notes') return send(200, []);
      return send(401, { error: 'UNAUTHORIZED' });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}/`;
});
after(() => server.close());

const run = (env = {}) => { seen = []; return collectEvidence({ config, baseUrl, env }); };

test('토큰이 없으면 정상 요청(로그인 사용자)은 보내지 않고 미실행, 나머지는 실측한다', async () => {
  mode = 'safe';
  const rows = await run();
  const unsent = rows.filter((row) => row.verdict === '미실행');
  assert.equal(unsent.length, NOT_SENT.length + 1, '보내지 않는 항목 + 토큰 필요한 정상 요청 1줄');
  assert.ok(unsent.every((row) => row.requestId === '-' && row.at === '-' && row.actual === '-'), '미실행 줄에 요청 ID·시각·결과를 지어 넣지 않는다');
  const measured = rows.filter((row) => row.verdict !== '미실행');
  assert.equal(measured.length, plannedRequests(config).length - 1);
  assert.ok(measured.every((row) => row.verdict === '일치'));
  assert.equal(seen.length, measured.length, '표의 실측 줄 수와 실제로 보낸 요청 수가 같다');
  assert.ok(!rows.some((row) => /통과/u.test(JSON.stringify(row))), '표에 통과라는 판정을 쓰지 않는다');
});

test('요청 ID는 응답 헤더 값이고 확인 시각은 시각 모양이며, 정상과 금지가 모두 실측으로 남는다', async () => {
  mode = 'safe';
  const rows = await run({ EVIDENCE_TOKEN_A: GOOD_TOKEN });
  const measured = rows.filter((row) => row.verdict !== '미실행');
  assert.ok(measured.every((row) => /^icn1::test-\d+$/u.test(row.requestId)));
  assert.ok(measured.every((row) => !Number.isNaN(Date.parse(row.at))));
  assert.ok(measured.some((row) => row.kind === '정상' && row.verdict === '일치'));
  assert.ok(measured.some((row) => row.kind === '금지' && row.verdict === '일치'));
  const normalApi = rows.find((row) => row.request.includes('로그인한 사용자 A'));
  assert.equal(normalApi.actual, 'HTTP 200');
  assert.equal(normalApi.verdict, '일치');
});

test('막히지 말아야 할 요청이 막히지 않거나 공개 파일에 메모가 있으면 불일치로 남는다', async () => {
  mode = 'open';
  const open = await run();
  assert.ok(open.filter((row) => row.kind === '금지' && row.verdict !== '미실행').every((row) => row.verdict === '불일치'));
  mode = 'leaky-data';
  const leaky = await run();
  assert.equal(leaky.find((row) => row.request === 'GET /data.json').verdict, '불일치');
});

test('서버에 닿지 못하면 요청 실패와 불일치로 남기고 결과를 지어내지 않는다', async () => {
  const rows = await collectEvidence({ config, baseUrl: 'http://localhost:1/', env: {} });
  const first = rows.find((row) => row.request === 'GET /');
  assert.equal(first.actual, '요청 실패');
  assert.equal(first.verdict, '불일치');
  assert.equal(first.requestId, '없음');
});

test('표에는 모든 칸이 있고 41종 미실행이 적히며, 토큰 값은 어디에도 없다', async () => {
  mode = 'safe';
  const rows = await run({ EVIDENCE_TOKEN_A: GOOD_TOKEN });
  const table = renderTable(rows, { baseUrl });
  for (const heading of ['단계', '구분', '요청', '기대 결과', '실제 API 결과', '요청 ID', '확인 시각', '판정']) assert.ok(table.includes(heading), heading);
  assert.ok(table.includes('41종 공격 시험: 미실행'));
  assert.ok(!table.includes(GOOD_TOKEN) && !JSON.stringify(rows).includes(GOOD_TOKEN));
  for (let stage = 1; stage <= 11; stage += 1) assert.ok(rows.some((row) => row.stage === stage), `${stage}단계 줄이 있다`);
});
