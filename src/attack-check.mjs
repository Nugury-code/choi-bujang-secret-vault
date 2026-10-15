import { randomUUID } from 'node:crypto';

// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  if (config.step >= 3) return runLoginChecks(config, app);
  if (config.step === 2) return runStep2Checks(config, app);
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

// 실제로 보낸 요청의 결과만 적습니다. 메모 제목·본문, 토큰, 키는 기록하지 않습니다.
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

async function send(app, path, { method = 'GET', token, body, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(new URL(path, app), {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const at = new Date().toISOString();
    let data = null;
    try {
      data = await response.json();
    } catch {
      // JSON이 아닌 응답은 본문 없음으로 처리합니다.
    }
    return { status: response.status, body: data, requestId: response.headers.get('x-vercel-id'), at: at };
  } catch {
    return { status: null, body: null };
  }
}

// 실제로 받은 응답의 요청 ID(응답 헤더 x-vercel-id)와 확인 시각(응답을 받은 시각)을 결과 글자에 붙입니다.
// 헤더가 없으면 「없음」으로 적고 지어내지 않습니다. 응답을 받지 못한 요청에는 붙이지 않습니다.
const trace = (r) => (r.status === null ? '' : ` · 요청 ID ${r.requestId || '없음'} · 확인 시각 ${r.at}`);

// 파일 내용을 검색하려고 글자 그대로 읽습니다. 내용은 기록하지 않습니다.
async function fetchText(app, path) {
  try {
    const response = await fetch(new URL(path, app), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const at = new Date().toISOString();
    return { status: response.status, text: response.ok ? await response.text() : '', requestId: response.headers.get('x-vercel-id'), at };
  } catch {
    return { status: null, text: '' };
  }
}

// 2단계: 자료는 서버 함수가 읽습니다. 공개 data.json에 메모가 없는지 요청해 봅니다.
async function staticDataCheck(config, app) {
  const result = await send(app, '/data.json');
  const body = result.body;
  let observed;
  if (result.status === null) {
    observed = '요청이 실패해 확인하지 못함';
  } else if (result.status !== 200 || !body || !Array.isArray(body.notes)) {
    observed = `공개 data.json을 읽지 못함 (HTTP ${result.status})`;
  } else if (body.notes.length === 0 && !('sampleMarker' in body)
      && JSON.stringify(body).indexOf(config.sampleMarker) === -1) {
    observed = '비로그인 요청에서 메모 0건, 확인 표시 없음 (HTTP 200)';
  } else {
    observed = `비로그인 요청에서 메모 ${body.notes.length}건 또는 확인 표시가 보임 (HTTP 200)`;
  }
  return { attackId: 'static_data_has_no_notes', expected: '공개 data.json에 메모와 확인 표시가 없음', observed: `${observed}${trace(result)}` };
}

const noteCount = (body) => (Array.isArray(body) ? body.length : Array.isArray(body?.notes) ? body.notes.length : null);

async function runStep2Checks(config, app) {
  const staticResult = await staticDataCheck(config, app);
  const apiResult = await send(app, '/api/notes');
  let apiObserved;
  if (apiResult.status === null) {
    apiObserved = '요청이 실패해 확인하지 못함';
  } else if (apiResult.status === 200 && noteCount(apiResult.body) !== null) {
    apiObserved = `로그인 없이 서버 함수가 메모 ${noteCount(apiResult.body)}건을 내려 줌 (HTTP 200). 토큰 검사가 막지 못한 공개 약점`;
  } else if (apiResult.status === 401 && noteCount(apiResult.body) === null) {
    apiObserved = '로그인 토큰 없이 서버 함수를 부르면 자료 없이 거절됨 (HTTP 401)';
  } else {
    apiObserved = `로그인 없이 서버 함수 요청이 거절되거나 실패함 (HTTP ${apiResult.status})`;
  }
  return [
    staticResult,
    { attackId: 'anonymous_api_read', expected: '로그인 토큰 없이 서버 함수를 부르면 자료 없이 거절됨 (HTTP 401)', observed: `${apiObserved}${trace(apiResult)}` },
  ];
}

// 로그인 정보 없이 만든 가짜 토큰입니다. 모양만 JWT이고 서명은 아무 값이라 서버가 서명을 확인하면 거절해야 합니다.
// 값은 요청에만 쓰고 저장·출력하지 않습니다.
function fakeToken(config, { audience, expiresInSeconds }) {
  // Buffer는 Node 전용이라 쓰지 않습니다. 글자를 UTF-8 바이트로 바꾼 뒤 base64url(패딩 없음)로 직접 만듭니다.
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const encode = (bytes) => {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      out += table[(n >> 18) & 63] + table[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += table[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += table[n & 63];
    }
    return out;
  };
  const utf8 = (text) => {
    const bytes = [];
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return bytes;
  };
  const part = (value) => encode(utf8(JSON.stringify(value)));
  const now = Math.floor(Date.now() / 1000);
  const header = part({ alg: 'ES256', typ: 'JWT' });
  const payload = part({
    iss: config.identityProvider?.issuer, aud: audience, role: 'authenticated', sub: randomUUID(),
    iat: now - 60, exp: now + expiresInSeconds,
  });
  return `${header}.${payload}.${encode(new Array(64).fill(7))}`;
}

// 3~5단계: 로그인 정보 없이 보낼 수 있는 요청이 모두 자료 없이 거절되는지 배포 주소로 실제로 보냅니다.
// 정상 A 로그인 뒤 요청과 진짜 서명된 만료 토큰은 로그인 정보가 필요해 이 점검에서는 보내지 않습니다(미실행).
// 4단계의 "A와 B가 서로의 메모에 접근하지 못함"도 서명된 두 로그인 토큰이 필요해 보내지 않고 미실행으로 적습니다.
async function runLoginChecks(config, app) {
  const idp = config.identityProvider ?? {};
  const unknownId = randomUUID();
  const outcome = (what, r, note) => {
    const suffix = note ? ` ${note}` : '';
    if (r.status === null) return `요청이 실패해 확인하지 못함${suffix}`;
    if (r.status === 401 && noteCount(r.body) === null && !r.body?.id) return `${what} 요청이 자료 없이 거절됨 (HTTP 401)${suffix}${trace(r)}`;
    if (r.status >= 200 && r.status < 300) return `${what} 요청이 막히지 않고 성공함 (HTTP ${r.status}). 막지 못한 약점${suffix}${trace(r)}`;
    return `${what} 요청의 응답이 401이 아님 (HTTP ${r.status}). 거절 방식을 확인해야 함${suffix}${trace(r)}`;
  };
  const attempts = [
    { attackId: 'anonymous_note_read', what: '로그인 토큰 없이 목록 읽기', path: '/api/notes' },
    { attackId: 'anonymous_note_create', what: '로그인 없이 메모 추가', path: '/api/notes', method: 'POST', body: { title: '점검', body: '점검' } },
    { attackId: 'anonymous_note_update', what: '로그인 없이 메모 수정', path: `/api/notes/${unknownId}`, method: 'PUT', body: { title: '점검', body: '점검' } },
    { attackId: 'anonymous_note_delete', what: '로그인 없이 메모 삭제', path: `/api/notes/${unknownId}`, method: 'DELETE' },
    { attackId: 'forged_token_read', what: '서명이 위조된 토큰으로 목록 읽기', path: '/api/notes',
      token: fakeToken(config, { audience: idp.audience, expiresInSeconds: 600 }) },
    { attackId: 'expired_token_read', what: '만료 시각이 지난 가짜 토큰으로 목록 읽기', note: '(진짜 서명된 만료 토큰은 미실행)', path: '/api/notes',
      token: fakeToken(config, { audience: idp.audience, expiresInSeconds: -600 }) },
    { attackId: 'other_service_token_read', what: '다른 서비스용(audience가 다른) 가짜 토큰으로 목록 읽기', note: '(진짜 서명된 토큰은 미실행)', path: '/api/notes',
      token: fakeToken(config, { audience: 'other-service', expiresInSeconds: 600 }) },
  ];
  // 10단계: 복구 경로(POST /api/notes/:id/restore)도 로그인 없이는 자료 없이 거절돼야 합니다. 아는 id 없이 임의의 UUID로만 보냅니다.
  if (config.step >= 10) {
    attempts.push({ attackId: 'anonymous_restore', what: '로그인 없이 메모 복원', path: `/api/notes/${unknownId}/restore`, method: 'POST' });
  }
  // 11단계: 기기 승인 요청 경로(POST /api/device)도 로그인 없이는 거절돼야 합니다.
  if (config.step >= 11) {
    attempts.push({ attackId: 'anonymous_device_request', what: '로그인 없이 기기 승인 요청', path: '/api/device', method: 'POST', body: {} });
  }
  // 12단계: 탈환 작전실 요약 경로(GET /api/ops)도 로그인 없이는 자료 없이 거절돼야 합니다.
  if (config.step >= 12) {
    attempts.push({ attackId: 'anonymous_ops_read', what: '로그인 없이 작전실 요약 읽기', path: '/api/ops' });
  }
  const results = [await staticDataCheck(config, app)];
  for (const item of attempts) {
    // 쓰기 요청(POST·PUT·DELETE·PATCH)은 묶음을 만드는 중에 보내지 않고 not_run으로 남깁니다. GET·HEAD만 보냅니다.
    if (WRITE_METHODS.has(item.method)) {
      results.push({ attackId: item.attackId, expected: `${item.what} 요청이 자료 없이 거절됨 (HTTP 401)`, observed: 'not_run' });
      continue;
    }
    const response = await send(app, item.path, item);
    results.push({
      attackId: item.attackId,
      expected: `${item.what} 요청이 자료 없이 거절됨 (HTTP 401)`,
      observed: outcome(item.what, response, item.note),
    });
  }
  if (config.step >= 5) results.push(...await runDirectChecks(config, app));
  if (config.step >= 10) {
    // 사본 표에 있는 시험 계정 B의 메모 한 건을 실제로 복원하는 요청은 서명된 B 로그인 토큰이 필요해 보내지 않습니다.
    results.push({
      attackId: 'restore_backup_note',
      expected: '복원 대상 한 건의 ID·소유자·내용 해시가 사본과 같고, 다른 사용자의 복원 요청은 거부됨',
      observed: 'not_run',
    });
  }
  if (config.step >= 11) {
    // 승인 요청 → 주인의 승인 → 승인 뒤 자료 열기는 로그인 토큰과 주인의 Supabase 승인이 필요해 보내지 않습니다.
    results.push({
      attackId: 'device_approval_flow',
      expected: '승인 전에는 자료가 화면에 없고, 서버가 등록 기기로 확인한(approved) 뒤에만 기존 화면이 열림',
      observed: 'not_run',
    });
  }
  if (config.step >= 12) {
    // 로그인한 사용자의 작전실 요약(읽음/미실행 구분, 메모 본문 없음)은 서명된 로그인 토큰이 필요해 보내지 않습니다.
    results.push({
      attackId: 'ops_room_summary',
      expected: '로그인한 사용자 본인의 요약만 나오고 읽음과 미실행이 구분되며 메모 본문이 없음',
      observed: 'not_run',
    });
  }
  if (config.step >= 4) {
    // 서명된 A·B 로그인 토큰 없이는 보낼 수 없습니다. 토큰을 만들거나 저장하지 않으므로 보내지 않았다고 적습니다.
    results.push({
      attackId: 'cross_owner_access',
      expected: 'A·B는 자기 메모만 읽기·추가·수정·삭제하고, 상대 메모 접근과 소유자 변경은 거부됨',
      observed: 'not_run',
    });
  }
  return results;
}

// 5단계: 원본 자료 API를 공개 키로 직접 조회·수정해 보고, 공개 파일에 서버 전용 키와 공개 키가 있는지 찾습니다.
// 공개 키는 화면 파일에 없어야 하므로(서버 함수에만 둡니다) 직접 요청에 쓸 키는 점검을 실행할 때 환경변수 SUPABASE_PUBLISHABLE_KEY로 줄 때만 보냅니다.
// 키가 없으면 보내지 않고 미실행으로 적습니다. 키는 결과에 적지 않습니다. 직접 수정은 일치하는 행이 없는 조건으로만 보내 자료를 바꾸지 않습니다.
// 로그인한 시험 계정의 토큰으로 직접 부르는 요청은 로그인 정보가 필요해 보내지 않습니다.
const PUBLIC_KEY_PATTERN = /sb_publishable_[A-Za-z0-9_-]{16,}/u;
const SERVER_KEY_PATTERN = /\bsb_secret_[A-Za-z0-9_-]{12,}/u;
const TOKEN_PATTERN = /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/u;
const PUBLIC_FILES = ['/', '/app.js', '/data.json'];

async function runDirectChecks(config, app) {
  const readExpected = '공개 키로 원본 자료 API를 직접 조회하면 자료 없이 거절됨 (HTTP 401 또는 403)';
  const updateExpected = '공개 키로 원본 자료 API를 직접 수정하면 거절됨 (HTTP 401 또는 403)';
  const files = [];
  for (const path of PUBLIC_FILES) files.push({ path, ...(await fetchText(app, path)) });

  let original = null;
  try {
    const url = new URL(config.originalApiUrl);
    if (url.protocol === 'https:' && !url.search && !url.hash && !url.username && !url.password) original = url;
  } catch {
    // 주소가 없으면 아래에서 미실행으로 적습니다.
  }
  const given = process.env.SUPABASE_PUBLISHABLE_KEY;
  const key = typeof given === 'string' && PUBLIC_KEY_PATTERN.test(given) ? given.trim()
    : files.map((file) => PUBLIC_KEY_PATTERN.exec(file.text)?.[0]).find(Boolean);
  const results = [];
  if (!original || !key) {
    results.push({ attackId: 'direct_data_api_read', expected: readExpected, observed: 'not_run' });
    results.push({ attackId: 'direct_data_api_update', expected: updateExpected, observed: 'not_run' });
  } else {
    const headers = { apikey: key };
    const read = await send(original, original.href, { headers });
    let readObserved;
    if (read.status === null) readObserved = '요청이 실패해 확인하지 못함';
    else if (read.status === 401 || read.status === 403) readObserved = `공개 키로 원본 자료 API를 직접 조회하면 자료 없이 거절됨 (HTTP ${read.status})`;
    else if (read.status >= 200 && read.status < 300) readObserved = `공개 키로 원본 자료 API를 직접 조회하는 요청이 막히지 않고 성공함 (HTTP ${read.status}). 막지 못한 약점`;
    else readObserved = `공개 키로 원본 자료 API를 직접 조회한 응답이 401·403이 아님 (HTTP ${read.status}). 거절 방식을 확인해야 함`;
    results.push({ attackId: 'direct_data_api_read', expected: readExpected, observed: `${readObserved}${trace(read)}` });

    // 공개 키로 원본 자료를 수정하는 요청(PATCH)은 쓰기 요청이라 보내지 않고 not_run으로 남깁니다.
    results.push({ attackId: 'direct_data_api_update', expected: updateExpected, observed: 'not_run' });
  }

  const readable = files.filter((file) => file.status !== null && file.text !== '');
  const found = [];
  for (const file of readable) {
    if (SERVER_KEY_PATTERN.test(file.text)) found.push(`${file.path}에 서버 전용 키 모양`);
    if (PUBLIC_KEY_PATTERN.test(file.text)) found.push(`${file.path}에 Supabase 공개 키 모양`);
    if (TOKEN_PATTERN.test(file.text)) found.push(`${file.path}에 로그인 토큰 모양`);
    if (file.text.includes(config.sampleMarker)) found.push(`${file.path}에 가상 메모 확인 표시`);
  }
  let searched;
  if (!readable.length) searched = '공개 파일을 읽지 못해 확인하지 못함';
  else if (found.length) searched = `공개 파일 ${readable.length}개에서 ${found.join(', ')}가 보임. 막지 못한 약점`;
  else searched = `공개 파일 ${readable.length}개(${readable.map((file) => file.path).join(', ')})에서 서버 전용 키 모양·Supabase 공개 키 모양·로그인 토큰 모양·가상 메모 확인 표시가 보이지 않음`;
  if (readable.length && readable.length < PUBLIC_FILES.length) searched += ` (읽지 못한 파일 ${PUBLIC_FILES.length - readable.length}개)`;
  const received = files.filter((file) => file.status !== null);
  // 받은 응답마다 HTTP 상태와 요청 ID를 같은 순서(/, /app.js, /data.json)로 적습니다. 확인 시각은 마지막 응답을 받은 시각입니다.
  if (received.length) searched += ` · HTTP ${received.map((file) => file.status).join('/')} · 요청 ID ${received.map((file) => file.requestId || '없음').join(' / ')} · 확인 시각 ${received[received.length - 1].at}`;
  results.push({ attackId: 'static_files_have_no_server_secret', expected: '공개 정적 파일과 브라우저 묶음에서 서버 전용 키·공개 키·확인 표시가 보이지 않음', observed: searched });
  return results;
}
