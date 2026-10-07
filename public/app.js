// 3단계 로그인 화면. 공식 Supabase SDK(/vendor/supabase.js, 빌드가 node_modules에서 복사)만 쓰고
// 비밀번호 확인과 토큰 발급은 Supabase Auth가 합니다. 이 파일에는 공개용 값만 있습니다.
const SUPABASE_URL = 'https://hphdsuxmehoshbcdyjvc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Rn7GgSFuUWmpVwt_Q-E_og_q2VbZwoy';

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
function reasonOf(error) {
  const code = error?.code ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/iu.test(error?.message ?? '')) {
    return '이메일 또는 비밀번호가 맞지 않습니다.';
  }
  if (code === 'email_not_confirmed') return '이메일 인증이 아직 끝나지 않은 계정입니다.';
  if (code === 'over_request_rate_limit' || error?.status === 429) {
    return '시도가 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.';
  }
  if (code === 'user_banned') return '이 계정은 지금 로그인할 수 없습니다.';
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) {
    return '로그인 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.';
  }
  return `로그인하지 못했습니다.${code ? ` (오류 코드: ${code})` : ''}`;
}

function render(session) {
  const email = session?.user?.email ?? '';
  document.body.dataset.auth = session ? 'signed-in' : 'signed-out';
  form.hidden = Boolean(session);
  signedIn.hidden = !session;
  $('account-email').textContent = email;
  status.textContent = session ? '로그인되어 있습니다.' : '로그인하지 않은 상태입니다.';
  token = session?.access_token ?? null;
  loadNotes(session?.user?.id ?? null);
}

// 자료 목록·추가·수정·삭제는 로그인 토큰을 실어 /api/notes 로 보냅니다. 토큰 검사와 사용자 확인은 서버가 하며,
// 화면은 userId·owner_id·role 같은 값을 보내지 않고 SDK가 준 access_token과 제목·내용만 보냅니다.
const list = document.querySelector('#notes');
const editor = $('note-editor');
const noteForm = $('note-form');
const noteError = $('note-error');
const addButton = $('note-add');
const NOTE_RULE = '제목(120자 이하)과 내용(5000자 이하)을 확인해 주세요.';
let token = null;
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
  return '서버에서 처리하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';
}

async function callApi(path, method, payload) {
  if (!token) throw Object.assign(new Error('NO_TOKEN'), { status: 401 });
  const headers = { Authorization: `Bearer ${token}` };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
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

function setupAuth() {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // 상태 변화 안에서는 화면만 바꿉니다(여기서 SDK를 다시 부르지 않습니다).
  client.auth.onAuthStateChange((_event, session) => render(session));

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
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) showError(reasonOf(error));
      else $('password').value = '';
    } catch (error) {
      showError(reasonOf(error));
    } finally {
      loginButton.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    showError('');
    logoutButton.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) showError('로그아웃 요청이 서버에 닿지 않았지만 이 브라우저의 로그인 정보는 지웠습니다.');
    } catch {
      showError('로그아웃 중 오류가 났습니다. 다시 시도해 주세요.');
    } finally {
      logoutButton.disabled = false;
    }
  });

  // 시작할 때 저장된 로그인 상태를 한 번 읽어 화면에 반영합니다.
  client.auth.getSession().then(({ data }) => render(data.session)).catch(() => render(null));
}

if (window.supabase?.createClient) {
  setupAuth();
} else {
  status.textContent = '로그인 기능을 불러오지 못했습니다.';
  loadNotes(null);
  showError('로그인 SDK 파일(/vendor/supabase.js)을 읽지 못했습니다. 다시 배포되었는지 확인해 주세요.');
}
