import { randomUUID } from 'node:crypto';

// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  if (config.step === 3 || config.step === 4) return runLoginChecks(config, app);
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
async function send(app, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(new URL(path, app), {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      // JSON이 아닌 응답은 본문 없음으로 처리합니다.
    }
    return { status: response.status, body: data };
  } catch {
    return { status: null, body: null };
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
  return { attackId: 'static_data_has_no_notes', expected: '공개 data.json에 메모와 확인 표시가 없음', observed };
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
    { attackId: 'anonymous_api_read', expected: '로그인 토큰 없이 서버 함수를 부르면 자료 없이 거절됨 (HTTP 401)', observed: apiObserved },
  ];
}

// 로그인 정보 없이 만든 가짜 토큰입니다. 모양만 JWT이고 서명은 아무 값이라 서버가 서명을 확인하면 거절해야 합니다.
// 값은 요청에만 쓰고 저장·출력하지 않습니다.
function fakeToken(config, { audience, expiresInSeconds }) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = part({ alg: 'ES256', typ: 'JWT' });
  const payload = part({
    iss: config.identityProvider?.issuer, aud: audience, role: 'authenticated', sub: randomUUID(),
    iat: now - 60, exp: now + expiresInSeconds,
  });
  return `${header}.${payload}.${Buffer.alloc(64, 7).toString('base64url')}`;
}

// 3·4단계: 로그인 정보 없이 보낼 수 있는 요청이 모두 자료 없이 거절되는지 배포 주소로 실제로 보냅니다.
// 정상 A 로그인 뒤 요청과 진짜 서명된 만료 토큰은 로그인 정보가 필요해 이 점검에서는 보내지 않습니다(미실행).
// 4단계의 "A와 B가 서로의 메모에 접근하지 못함"도 서명된 두 로그인 토큰이 필요해 보내지 않고 미실행으로 적습니다.
async function runLoginChecks(config, app) {
  const idp = config.identityProvider ?? {};
  const unknownId = randomUUID();
  const outcome = (what, r, note) => {
    const suffix = note ? ` ${note}` : '';
    if (r.status === null) return `요청이 실패해 확인하지 못함${suffix}`;
    if (r.status === 401 && noteCount(r.body) === null && !r.body?.id) return `${what} 요청이 자료 없이 거절됨 (HTTP 401)${suffix}`;
    if (r.status >= 200 && r.status < 300) return `${what} 요청이 막히지 않고 성공함 (HTTP ${r.status}). 막지 못한 약점${suffix}`;
    return `${what} 요청의 응답이 401이 아님 (HTTP ${r.status}). 거절 방식을 확인해야 함${suffix}`;
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
  const results = [await staticDataCheck(config, app)];
  for (const item of attempts) {
    const response = await send(app, item.path, item);
    results.push({
      attackId: item.attackId,
      expected: `${item.what} 요청이 자료 없이 거절됨 (HTTP 401)`,
      observed: outcome(item.what, response, item.note),
    });
  }
  if (config.step >= 4) {
    // 서명된 A·B 로그인 토큰 없이는 보낼 수 없습니다. 토큰을 만들거나 저장하지 않으므로 보내지 않았다고 적습니다.
    results.push({
      attackId: 'cross_owner_access',
      expected: 'A·B는 자기 메모만 읽기·추가·수정·삭제하고, 상대 메모 접근과 소유자 변경은 거부됨',
      observed: '미실행: 서명된 A·B 로그인 토큰이 필요해 이 점검에서는 보내지 않음',
    });
  }
  return results;
}
