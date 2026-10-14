// 로그인 화면. 로그인·토큰 갱신·로그아웃은 모두 같은 사이트의 서버 함수(/api/auth/…)가 Supabase Auth와 주고받습니다.
// 이 파일에는 Supabase 주소도 공개 키도 없습니다. 비밀번호는 서버 함수로 보내기만 하고 저장하지 않으며,
// 서버가 준 짧은 접근 토큰은 이 페이지의 메모리에만 둡니다(저장소·쿠키에 쓰지 않습니다).
// 오래 사는 갱신 토큰은 서버가 JavaScript가 읽을 수 없는 쿠키(HttpOnly)로만 보관합니다.

const $ = (id) => document.getElementById(id);
const form = $('login-form');
const signedIn = $('signed-in');
const status = $('auth-status');
const errorBox = $('auth-error');
const loginButton = $('login-button');
const logoutButton = $('logout-button');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

// 로그인 실패 이유를 사람이 읽을 수 있게 알려 주되, 계정이 있는지 없는지는 구분하지 않습니다.
function reasonOfLogin(status, code) {
  if (status === 401 && code === 'INVALID_CREDENTIALS') return '이메일 또는 비밀번호가 맞지 않습니다.';
  if (code === 'EMAIL_NOT_CONFIRMED') return '이메일 인증이 아직 끝나지 않은 계정입니다.';
  if (code === 'ACCOUNT_BLOCKED') return '이 계정은 지금 로그인할 수 없습니다.';
  if (status === 429) return '시도가 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.';
  if (status === 400) return '이메일과 비밀번호를 확인해 주세요.';
  if (status === null || status >= 500) return '로그인 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.';
  return `로그인하지 못했습니다.${code ? ` (오류 코드: ${code})` : ''}`;
}

// 서버 함수(/api/auth/…)에 JSON을 보냅니다. 갱신 토큰 쿠키는 브라우저가 같은 사이트 요청에만 자동으로 붙입니다.
async function authCall(path, payload, accessToken) {
  const headers = {};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response;
  try {
    response = await fetch(path, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    return { status: null, data: null };
  }
  let data = null;
  try { data = await response.json(); } catch { /* 본문이 없거나 JSON이 아닙니다. */ }
  return { status: response.status, data };
}

let token = null;
let refreshTimer = null;

function sessionFrom(data) {
  if (typeof data?.access_token !== 'string') return null;
  return { access_token: data.access_token, expires_in: data.expires_in,
    user: { id: data.user?.id ?? null, email: data.user?.email ?? '' } };
}

// 접근 토큰이 끝나기 1분 전에 서버에서 새 토큰을 받아 둡니다.
function scheduleRefresh(session) {
  clearTimeout(refreshTimer);
  const seconds = Number.isFinite(session?.expires_in) ? session.expires_in : 3600;
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, Math.max(30, seconds - 60) * 1000);
}

let refreshing = null;
// 서버에 새 접근 토큰을 요청합니다(동시에 여러 번 부르면 한 번만 보냅니다). 실패하면 로그아웃 상태로 돌아갑니다.
function refreshSession() {
  refreshing ??= (async () => {
    const result = await authCall('/api/auth/refresh');
    const session = result.status === 200 ? sessionFrom(result.data) : null;
    if (session) render(session);
    else if (result.status === 401) render(null);
    else if (result.status === 429) showError('시도가 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.');
    return session;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// 기기 승인(11단계). 이 기기의 키 한 쌍은 이 페이지의 메모리에만 두고 어떤 저장소에도 쓰지 않습니다(새로고침하면 사라져 다시 요청해야 합니다).
// 서버가 준 status가 'approved'일 때만 자료를 불러옵니다. 요청 단추는 요청을 보낼 뿐이고 권한은 서버가 정합니다.
const deviceStatusText = $('device-status');
const deviceButton = $('device-request');
const deviceErrorBox = $('device-error');
const DEVICE_TEXT = {
  signedOut: '로그인하면 이 기기의 승인을 요청할 수 있습니다. 앱 설치 표시만으로 기기 확인이 끝난 것이 아니며, 승인 여부는 서버가 정합니다.',
  none: '이 기기는 아직 승인되지 않았습니다. 승인 전에는 자료를 표시하지 않습니다. 요청 단추는 요청을 보낼 뿐 권한을 주지 않습니다.',
  pending: '승인 대기 중입니다. 서버가 아직 이 기기를 등록 기기로 확인하지 않았습니다. 승인된 뒤에 "승인 상태 확인"을 눌러 주세요.',
  approved: '서버가 이 기기를 등록 기기로 확인했습니다.',
  rejected: '서버가 이 기기를 승인하지 않았습니다. 자료를 표시하지 않습니다.',
};
let deviceStatus = 'none';
let deviceKeys = null;

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function paintDevice() {
  const signedInNow = Boolean(token);
  deviceStatusText.textContent = signedInNow ? DEVICE_TEXT[deviceStatus] : DEVICE_TEXT.signedOut;
  deviceButton.hidden = !signedInNow || deviceStatus === 'approved' || deviceStatus === 'rejected';
  deviceButton.textContent = deviceStatus === 'pending' ? '승인 상태 확인' : '기기 승인 요청';
}

function resetDevice() {
  deviceStatus = 'none';
  deviceKeys = null;
  deviceErrorBox.hidden = true;
  paintDevice();
}

// 이 기기의 키(ECDSA P-256)를 한 번 만들고, 지문과 현재 시각에 서명해 서버에 보냅니다. 개인 키는 내보내지 않습니다(extractable: false).
async function requestDevice() {
  deviceErrorBox.hidden = true;
  deviceButton.disabled = true;
  try {
    deviceKeys ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const spki = await crypto.subtle.exportKey('spki', deviceKeys.publicKey);
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', spki));
    const signedAt = Date.now();
    const text = new TextEncoder().encode(`byte-back-device-request\n${fingerprint}\n${signedAt}`);
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, deviceKeys.privateKey, text);
    const result = await authCall('/api/device', { publicKey: toBase64(spki), signature: toBase64(signature), signedAt }, token);
    if (result.status === 200 && ['pending', 'approved', 'rejected'].includes(result.data?.status)) {
      deviceStatus = result.data.status;
    } else if (result.status === 401) {
      deviceErrorBox.textContent = '로그인 확인에 실패했습니다. 다시 로그인해 주세요.';
    } else if (result.status === 429) {
      deviceErrorBox.textContent = '요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.';
    } else {
      deviceErrorBox.textContent = '기기 승인 요청을 처리하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';
    }
    deviceErrorBox.hidden = !deviceErrorBox.textContent || result.status === 200;
  } catch {
    deviceErrorBox.textContent = '이 브라우저에서 기기 키를 만들지 못했습니다.';
    deviceErrorBox.hidden = false;
  } finally {
    deviceButton.disabled = false;
    paintDevice();
    loadedFor = undefined;
    loadNotes(currentUserId);
  }
}
deviceButton.addEventListener('click', requestDevice);

let currentUserId = null;

function render(session) {
  const email = session?.user?.email ?? '';
  document.body.dataset.auth = session ? 'signed-in' : 'signed-out';
  form.hidden = Boolean(session);
  signedIn.hidden = !session;
  $('account-email').textContent = email;
  status.textContent = session ? '로그인되어 있습니다.' : '로그인하지 않은 상태입니다.';
  token = session?.access_token ?? null;
  const nextUserId = session?.user?.id ?? null;
  if (nextUserId !== currentUserId) resetDevice();
  currentUserId = nextUserId;
  paintDevice();
  if (session) scheduleRefresh(session);
  else clearTimeout(refreshTimer);
  loadNotes(session?.user?.id ?? null);
}

// 자료 목록·추가·수정·삭제는 로그인 토큰을 실어 /api/notes 로 보냅니다. 토큰 검사와 사용자 확인은 서버가 하며,
// 화면은 userId·owner_id·role 같은 값을 보내지 않고 서버가 준 access_token과 제목·내용만 보냅니다.
const list = document.querySelector('#notes');
const editor = $('note-editor');
const noteForm = $('note-form');
const noteError = $('note-error');
const addButton = $('note-add');
const NOTE_RULE = '제목(120자 이하)과 내용(5000자 이하)을 확인해 주세요.';
let loadId = 0;
let loadedFor;

function showNoteError(message) {
  noteError.textContent = message;
  noteError.hidden = !message;
}

function showNotesMessage(message) {
  const item = document.createElement('li');
  item.textContent = message;
  list.replaceChildren(item);
}

// 서버 응답을 사람이 읽을 이유로 바꿉니다. 응답 본문의 글자는 화면에 그대로 쓰지 않습니다.
function reasonOfStatus(status) {
  if (status === 401) return '로그인 확인에 실패했습니다. 다시 로그인해 주세요.';
  if (status === 400) return NOTE_RULE;
  if (status === 404) return '이미 없는 메모입니다. 목록을 새로 불러왔습니다.';
  if (status === 409) return '같은 번호의 메모가 이미 있습니다.';
  if (status === 429) return '요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.';
  return '서버에서 처리하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';
}

async function callApi(path, method, payload, retried = false) {
  if (!token) throw Object.assign(new Error('NO_TOKEN'), { status: 401 });
  const headers = { Authorization: `Bearer ${token}` };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  // 접근 토큰이 끝났을 수 있으니 한 번만 새 토큰을 받아 다시 보냅니다.
  if (response.status === 401 && !retried && await refreshSession()) return callApi(path, method, payload, true);
  let data = null;
  try { data = await response.json(); } catch { /* 본문이 없거나 JSON이 아닙니다. */ }
  if (!response.ok) throw Object.assign(new Error('REQUEST_FAILED'), { status: response.status });
  return data;
}

function button(label, onClick, className) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

// 한 동작을 실행하고 단추를 잠갔다가, 끝나면 목록을 서버에서 다시 읽습니다.
async function act(buttons, task) {
  showNoteError('');
  for (const item of buttons) item.disabled = true;
  try {
    await task();
    await fetchList();
  } catch (error) {
    showNoteError(reasonOfStatus(error?.status));
    if (error?.status === 404) await fetchList().catch(() => {});
  } finally {
    for (const item of buttons) item.disabled = false;
  }
}

function renderNoteView(item, note) {
  const title = document.createElement('strong');
  const body = document.createElement('span');
  title.textContent = note.title;
  body.textContent = note.body;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const edit = button('수정', () => renderNoteEdit(item, note));
  const remove = button('삭제', () => renderNoteDelete(item, note), 'danger');
  actions.append(edit, remove);
  item.replaceChildren(title, body, actions);
}

function renderNoteEdit(item, note) {
  showNoteError('');
  const title = document.createElement('input');
  title.type = 'text';
  title.maxLength = 120;
  title.value = note.title;
  title.setAttribute('aria-label', '제목');
  const body = document.createElement('textarea');
  body.rows = 3;
  body.maxLength = 5000;
  body.value = note.body;
  body.setAttribute('aria-label', '내용');
  const actions = document.createElement('div');
  actions.className = 'actions';
  const save = button('저장', () => act([save, cancel], () => callApi(
    `/api/notes/${encodeURIComponent(note.id)}`, 'PUT', { title: title.value, body: body.value })));
  const cancel = button('취소', () => renderNoteView(item, note));
  actions.append(save, cancel);
  item.replaceChildren(title, body, actions);
  title.focus();
}

// 지우기는 한 번 더 눌러야 실행됩니다.
function renderNoteDelete(item, note) {
  const question = document.createElement('span');
  question.textContent = `"${note.title}" 메모를 지울까요?`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const confirmDelete = button('삭제 확인', () => act([confirmDelete, cancel], () => callApi(
    `/api/notes/${encodeURIComponent(note.id)}`, 'DELETE')), 'danger');
  const cancel = button('취소', () => renderNoteView(item, note));
  actions.append(confirmDelete, cancel);
  item.replaceChildren(question, actions);
}

function renderNotes(notes) {
  if (!notes.length) {
    showNotesMessage('아직 메모가 없습니다. 위에서 추가해 보세요.');
    return;
  }
  list.replaceChildren(...notes.map((note) => {
    const item = document.createElement('li');
    renderNoteView(item, note);
    return item;
  }));
}

async function fetchList() {
  const myId = ++loadId;
  try {
    const data = await callApi('/api/notes', 'GET');
    if (myId !== loadId) return;
    if (!Array.isArray(data)) throw new Error('자료 형식이 맞지 않습니다.');
    renderNotes(data.filter((note) => note && typeof note.id === 'string'
      && typeof note.title === 'string' && typeof note.body === 'string'));
  } catch (error) {
    if (myId !== loadId) return;
    loadedFor = undefined;
    showNotesMessage(error?.status === 401
      ? '로그인 확인에 실패해 자료를 보여 줄 수 없습니다. 다시 로그인해 주세요.'
      : '서버 자료를 읽을 수 없습니다.');
    throw error;
  }
}

// 로그인한 사용자가 바뀔 때(로그인·로그아웃)만 목록을 다시 읽습니다. 토큰 갱신만으로는 입력 중인 수정 창을 닫지 않습니다.
async function loadNotes(userId) {
  // 기기 승인 전에는 자료를 부르지도 보여 주지도 않습니다. 서버가 'approved'라고 답한 뒤에만 불러옵니다.
  if (userId && deviceStatus !== 'approved') {
    loadedFor = undefined;
    loadId += 1;
    editor.hidden = true;
    showNoteError('');
    showNotesMessage('기기 승인 전에는 자료를 표시하지 않습니다.');
    return;
  }
  if (loadedFor === userId) return;
  loadedFor = userId;
  editor.hidden = !userId;
  showNoteError('');
  if (!userId) {
    loadId += 1;
    showNotesMessage('로그인하면 자료가 보입니다.');
    return;
  }
  showNotesMessage('가상 자료를 불러오는 중입니다.');
  await fetchList().catch(() => {});
}

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('note-title');
  const body = $('note-body');
  if (!title.value.trim()) {
    showNoteError(NOTE_RULE);
    return;
  }
  await act([addButton], async () => {
    await callApi('/api/notes', 'POST', { title: title.value, body: body.value });
    title.value = '';
    body.value = '';
  });
});

// 오프라인 안내: 연결이 끊기면 안내를 보이고, 돌아오면 숨깁니다.
const offlineNotice = $('offline-notice');
function showOffline() { offlineNotice.hidden = navigator.onLine; }
window.addEventListener('offline', showOffline);
window.addEventListener('online', showOffline);
showOffline();

function setupAuth() {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || !password) {
      showError('이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }
    loginButton.disabled = true;
    try {
      const result = await authCall('/api/auth/login', { email, password });
      const session = result.status === 200 ? sessionFrom(result.data) : null;
      if (session) {
        $('password').value = '';
        render(session);
      } else {
        showError(reasonOfLogin(result.status, result.data?.error));
      }
    } finally {
      loginButton.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    showError('');
    logoutButton.disabled = true;
    const result = await authCall('/api/auth/logout', undefined, token);
    // 서버에 닿지 않아도 이 화면의 로그인 정보는 지웁니다.
    render(null);
    if (result.status !== 200) showError('로그아웃 요청이 서버에 닿지 않았지만 이 화면의 로그인 정보는 지웠습니다. 다시 시도해 주세요.');
    logoutButton.disabled = false;
  });

  // 시작할 때 서버에 로그인 상태(쿠키)를 한 번 물어 화면에 반영합니다.
  refreshSession().then((session) => { if (!session) render(null); }).catch(() => render(null));
}

setupAuth();
