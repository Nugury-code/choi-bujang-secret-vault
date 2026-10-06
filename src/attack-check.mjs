// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 1 && config.step !== 2) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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

// 2단계: 자료는 서버 함수가 읽습니다. 실제로 보낸 요청의 결과만 적고, 메모 제목·본문은 기록하지 않습니다.
async function getJson(url) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // JSON이 아닌 응답은 본문 없음으로 처리합니다.
    }
    return { status: response.status, body };
  } catch {
    return { status: null, body: null };
  }
}

async function runStep2Checks(config, app) {
  const staticResult = await getJson(new URL('/data.json', app));
  const staticBody = staticResult.body;
  let staticObserved;
  if (staticResult.status === null) {
    staticObserved = '요청이 실패해 확인하지 못함';
  } else if (staticResult.status !== 200 || !staticBody || !Array.isArray(staticBody.notes)) {
    staticObserved = `공개 data.json을 읽지 못함 (HTTP ${staticResult.status})`;
  } else if (staticBody.notes.length === 0 && !('sampleMarker' in staticBody)
      && JSON.stringify(staticBody).indexOf(config.sampleMarker) === -1) {
    staticObserved = '비로그인 요청에서 메모 0건, 확인 표시 없음 (HTTP 200)';
  } else {
    staticObserved = `비로그인 요청에서 메모 ${staticBody.notes.length}건 또는 확인 표시가 보임 (HTTP 200)`;
  }
  const apiResult = await getJson(new URL('/api/notes', app));
  let apiObserved;
  if (apiResult.status === null) {
    apiObserved = '요청이 실패해 확인하지 못함';
  } else if (apiResult.status === 200 && Array.isArray(apiResult.body?.notes)) {
    apiObserved = `로그인 없이 서버 함수가 메모 ${apiResult.body.notes.length}건을 내려 줌 (HTTP 200). 3단계 전까지 남는 공개 약점`;
  } else {
    apiObserved = `로그인 없이 서버 함수 요청이 거절되거나 실패함 (HTTP ${apiResult.status})`;
  }
  return [
    { attackId: 'static_data_has_no_notes', expected: '공개 data.json에 메모와 확인 표시가 없음', observed: staticObserved },
    { attackId: 'anonymous_api_read', expected: '로그인 없이 서버 함수를 불렀을 때의 결과를 기록 (3단계 전까지 공개 약점)', observed: apiObserved },
  ];
}
