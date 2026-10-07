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
}

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
  showError('로그인 SDK 파일(/vendor/supabase.js)을 읽지 못했습니다. 다시 배포되었는지 확인해 주세요.');
}

// 자료 목록은 2단계 그대로 /api/notes에서 읽습니다. 서버 보호는 다음 제작에서 붙입니다.
const list = document.querySelector('#notes');
try {
  const response = await fetch('/api/notes', { cache: 'no-store' });
  if (!response.ok) throw new Error('서버 자료를 읽을 수 없습니다.');
  const data = await response.json();
  if (!Array.isArray(data.notes)) throw new Error('자료 형식이 맞지 않습니다.');
  list.replaceChildren(...data.notes.map((note) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    const content = document.createElement('span');
    title.textContent = note.title;
    content.textContent = note.content;
    item.append(title, content);
    return item;
  }));
} catch (error) {
  const item = document.createElement('li');
  item.textContent = error.message;
  list.replaceChildren(item);
}
