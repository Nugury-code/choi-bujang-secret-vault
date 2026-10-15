import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 12단계: 1~11단계의 정상·금지 요청을 배포 주소로 실제로 보내고, 한 표로 남기는 절차입니다. 실행: npm run evidence
// - 표의 칸: 단계 · 구분(정상/금지) · 요청 · 기대 결과 · 실제 API 결과 · 요청 ID · 확인 시각 · 판정
// - 실제 API 결과는 이번 실행에서 받은 HTTP 상태이고, 요청 ID는 응답 헤더 x-vercel-id, 확인 시각은 응답을 받은 시각입니다. 헤더가 없으면 "없음"으로 적고 지어내지 않습니다.
// - 판정은 "일치"(실제 상태가 기대와 같음) 또는 "불일치". 보내지 않은 요청은 "미실행"이며 어떤 경우에도 통과로 바꾸지 않습니다.
// - 정상 요청(로그인한 사용자의 목록 읽기)은 서명된 로그인 토큰이 필요합니다. 토큰은 실행하는 창에서 환경변수 EVIDENCE_TOKEN_A로만 주며,
//   없으면 보내지 않고 미실행으로 적습니다. 토큰은 표·파일·화면 어디에도 적지 않습니다.
// - 이 표는 41종 공격 시험의 결과가 아닙니다. 41종은 실행하지 않았고, 표 끝에 그렇게 적습니다.
// 칸 이름, 판정 이름(일치/불일치), 요청 목록의 선택, 표 파일 위치(artifacts/evidence-table.md)는 내가 정한 값: 짐작.

const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function fakeToken(config, { audience, expiresInSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: config.identityProvider?.issuer, aud: audience, role: 'authenticated', sub: randomUUID(), iat: now - 60, exp: now + expiresInSeconds };
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(payload)}.${Buffer.alloc(64, 7).toString('base64url')}`;
}

// 보내는 요청 목록. needsToken이 true인 줄은 환경변수 토큰이 없으면 미실행입니다.
export function plannedRequests(config) {
  const idp = config.identityProvider ?? {};
  const unknown = randomUUID();
  return [
    { stage: 1, kind: '정상', label: 'GET /', method: 'GET', path: '/', expect: 200 },
    { stage: 1, kind: '정상', label: 'GET /aleph.json', method: 'GET', path: '/aleph.json', expect: 200 },
    { stage: 2, kind: '정상', label: 'GET /data.json', method: 'GET', path: '/data.json', expect: 200, check: 'emptyNotes' },
    { stage: 3, kind: '금지', label: '토큰 없이 GET /api/notes', method: 'GET', path: '/api/notes', expect: 401 },
    { stage: 3, kind: '금지', label: '토큰 없이 POST /api/notes', method: 'POST', path: '/api/notes', body: { title: '점검', body: '점검' }, expect: 401 },
    { stage: 3, kind: '금지', label: '토큰 없이 PUT /api/notes/:id', method: 'PUT', path: `/api/notes/${unknown}`, body: { title: '점검', body: '점검' }, expect: 401 },
    { stage: 3, kind: '금지', label: '토큰 없이 DELETE /api/notes/:id', method: 'DELETE', path: `/api/notes/${unknown}`, expect: 401 },
    { stage: 3, kind: '금지', label: '서명이 위조된 토큰으로 GET /api/notes', method: 'GET', path: '/api/notes', token: () => fakeToken(config, { audience: idp.audience, expiresInSeconds: 600 }), expect: 401 },
    { stage: 3, kind: '금지', label: '만료 시각이 지난 가짜 토큰으로 GET /api/notes', method: 'GET', path: '/api/notes', token: () => fakeToken(config, { audience: idp.audience, expiresInSeconds: -600 }), expect: 401 },
    { stage: 3, kind: '금지', label: '다른 서비스용 가짜 토큰으로 GET /api/notes', method: 'GET', path: '/api/notes', token: () => fakeToken(config, { audience: 'other-service', expiresInSeconds: 600 }), expect: 401 },
    { stage: 3, kind: '정상', label: '로그인한 사용자 A의 GET /api/notes', method: 'GET', path: '/api/notes', needsToken: true, expect: 200 },
    { stage: 10, kind: '금지', label: '토큰 없이 POST /api/notes/:id/restore', method: 'POST', path: `/api/notes/${unknown}/restore`, expect: 401 },
    { stage: 10, kind: '금지', label: '토큰 없이 GET /api/notes/:id/restore', method: 'GET', path: `/api/notes/${unknown}/restore`, expect: 401 },
    { stage: 11, kind: '금지', label: '토큰 없이 POST /api/device', method: 'POST', path: '/api/device', body: {}, expect: 401 },
  ];
}

// 이 절차가 보내지 않는 항목. 이유를 적고 미실행으로 남깁니다.
export const NOT_SENT = [
  { stage: 4, kind: '금지', label: 'A가 B의 메모를 읽거나 바꾸는 요청', why: '서명된 A·B 로그인 토큰과 B의 메모 번호가 필요해 보내지 않음' },
  { stage: 5, kind: '금지', label: '공개 키로 원본 자료 API 직접 조회·수정', why: '이 절차는 보내지 않음(src/attack-check.mjs가 키가 있을 때 보냄)' },
  { stage: 6, kind: '금지', label: '미등록 기기 요청', why: 'API 경로가 아니라 판정기 규칙(가상 요청 연습)이라 배포 주소로 보내지 않음' },
  { stage: 7, kind: '금지', label: '평소와 다른 접속의 재확인 요구', why: 'API 경로가 아니라 판정기 규칙(가상 요청 연습)이라 배포 주소로 보내지 않음' },
  { stage: 8, kind: '금지', label: '구역 밖 자료 조회', why: '강사 구역 API가 이 서버에 없어 보낼 요청이 없음' },
  { stage: 9, kind: '금지', label: '폭주 조회와 권한 회수', why: '탐지·회수는 가상 연습(detect:test)이고 운영 연결이 없어 보내지 않음' },
  { stage: 10, kind: '정상', label: '시험 계정 B의 사본 한 건 복원', why: '서명된 B 로그인 토큰과 사본 표가 필요해 보내지 않음' },
  { stage: 11, kind: '정상', label: '기기 승인 요청 뒤 승인된 기기의 자료 열기', why: '서명된 로그인 토큰과 주인의 승인이 필요해 보내지 않음' },
];

async function sendOne(baseUrl, item, token, fetchImpl) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (item.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetchImpl(new URL(item.path, baseUrl), {
      method: item.method, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      body: item.body === undefined ? undefined : JSON.stringify(item.body),
    });
    const at = new Date().toISOString();
    let data = null;
    try { data = await response.json(); } catch { /* 본문이 JSON이 아니면 없음으로 둡니다. */ }
    return { status: response.status, requestId: response.headers.get('x-vercel-id') || '없음', at, data };
  } catch {
    return { status: null, requestId: '없음', at: new Date().toISOString(), data: null };
  }
}

// 표의 줄 배열을 만듭니다. fetchImpl과 baseUrl은 시험에서 가짜 서버로 바꿀 수 있습니다.
export async function collectEvidence({ config, baseUrl, env = process.env, fetchImpl = fetch }) {
  const tokenA = typeof env.EVIDENCE_TOKEN_A === 'string' && env.EVIDENCE_TOKEN_A.trim() ? env.EVIDENCE_TOKEN_A.trim() : null;
  const rows = [];
  for (const item of plannedRequests(config)) {
    const base = { stage: item.stage, kind: item.kind, request: item.label, expected: `HTTP ${item.expect}` };
    const token = item.needsToken ? tokenA : item.token?.();
    if (item.needsToken && !tokenA) {
      rows.push({ ...base, actual: '-', requestId: '-', at: '-', verdict: '미실행', note: '환경변수 EVIDENCE_TOKEN_A(서명된 로그인 토큰)가 없어 보내지 않음' });
      continue;
    }
    const got = await sendOne(baseUrl, item, token, fetchImpl);
    let actual = got.status === null ? '요청 실패' : `HTTP ${got.status}`;
    let note = '';
    if (item.check === 'emptyNotes' && got.status === 200) {
      const count = Array.isArray(got.data?.notes) ? got.data.notes.length : null;
      actual += count === null ? ', 메모 목록 형식을 읽지 못함' : `, 메모 ${count}건`;
      if (count !== 0) note = '공개 파일에 메모가 있거나 형식이 다름';
    }
    const matched = got.status === item.expect && !note;
    rows.push({ ...base, actual, requestId: got.requestId, at: got.at, verdict: matched ? '일치' : '불일치', note });
  }
  for (const item of NOT_SENT) {
    rows.push({ stage: item.stage, kind: item.kind, request: item.label, expected: '-', actual: '-', requestId: '-', at: '-', verdict: '미실행', note: item.why });
  }
  rows.sort((a, b) => a.stage - b.stage);
  return rows;
}

const cell = (value) => String(value).replaceAll('|', '/').replaceAll('\n', ' ');

export function renderTable(rows, { baseUrl, now = new Date() }) {
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  const lines = [
    `# 1~11단계 정상·금지 요청 실측 표`,
    '',
    `- 배포 주소: ${baseUrl}`,
    `- 만든 시각: ${now.toISOString()}`,
    `- 실측 ${count('일치') + count('불일치')}줄 (일치 ${count('일치')}, 불일치 ${count('불일치')}), 미실행 ${count('미실행')}줄`,
    '',
    '| 단계 | 구분 | 요청 | 기대 결과 | 실제 API 결과 | 요청 ID | 확인 시각 | 판정 | 비고 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${[row.stage, row.kind, row.request, row.expected, row.actual, row.requestId, row.at, row.verdict, row.note || ''].map(cell).join(' | ')} |`),
    '',
    '- 41종 공격 시험: 미실행. 이 표는 41종의 결과가 아니며, 위 줄들이 전부 일치해도 41종 방어를 뜻하지 않습니다.',
    '- 판정이 미실행인 줄은 요청을 보내지 않은 것이며 통과로 세지 않습니다.',
  ];
  return `${lines.join('\n')}\n`;
}

export const OUTPUT_FILE = 'artifacts/evidence-table.md';

async function main() {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  let app;
  try { app = new URL(config.publicAppUrl); } catch { app = null; }
  if (!app || app.protocol !== 'https:' || app.username || app.password || app.search || app.hash || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  const rows = await collectEvidence({ config, baseUrl: app.href });
  const table = renderTable(rows, { baseUrl: app.href });
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../${OUTPUT_FILE}`, import.meta.url), table, 'utf8');
  console.log(table);
  console.log(`표를 ${OUTPUT_FILE}에 저장했습니다(Git에는 올라가지 않는 폴더).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
