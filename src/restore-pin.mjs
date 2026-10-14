// 10단계: 복구 요청 본문에 "이 사본이 맞는지 확인해 달라"는 값이 실려 오면 읽어 두는 곳입니다.
// 이 값은 "복원해도 되는지 대조"하는 데만 쓰고, 복원할 내용으로는 절대 쓰지 않습니다(복원 내용은 서버의 검증된 사본뿐).
// 대조 값(id, 사본 내용)이 주소의 id·서버의 검증된 사본과 하나라도 다르면 복원하지 않고 멈춥니다. 값이 없으면 그냥 건너뜁니다.
// 소유자 값은 읽어서 감사 기록의 "값이 왔는지"에만 쓰고 복원 여부에는 쓰지 않습니다(아래 pinConflicts 설명).
// 문서에 요청 모양이 없어 이름은 내가 정한 짐작입니다: id(id·noteId·note_id), 소유자(ownerId·owner_id·owner·userId·user_id),
// 사본 내용(backup·snapshot·expected·copy·source·submitted 안의 title과 content·body·text).
// 모양이 틀린 값(UUID가 아닌 id 등)은 없는 것으로 보고 무시합니다(엉뚱한 칸 때문에 정상 복구를 막지 않으려는 것).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTAINERS = ['backup', 'snapshot', 'expected', 'copy', 'source', 'submitted'];
const ID_KEYS = ['id', 'noteId', 'note_id'];
const OWNER_KEYS = ['ownerId', 'owner_id', 'owner', 'userId', 'user_id'];
const TITLE_KEYS = ['title'];
const CONTENT_KEYS = ['content', 'body', 'text'];
const TEXT_MAX = 20000;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function pick(object, keys, accept) {
  const found = [];
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && accept(value)) found.push(value);
  }
  return found;
}

function safeKey(key) {
  return /^[A-Za-z0-9_.-]{1,40}$/u.test(key) ? key : '?';
}

// 요청 본문(없으면 null)에서 대조 값과 "어떤 이름이 왔는지"만 읽습니다.
export function readPin(body) {
  const pin = { ids: [], owners: [], title: null, content: null, inconsistent: false, keys: [] };
  if (!isObject(body)) return pin;
  const levels = [{ object: body, nested: false }];
  for (const name of CONTAINERS) if (isObject(body[name])) levels.push({ object: body[name], nested: true, name });
  const titles = new Set();
  const contents = new Set();
  for (const { object, nested, name } of levels) {
    for (const key of Object.keys(object).slice(0, 20)) pin.keys.push(nested ? `${name}.${safeKey(key)}` : safeKey(key));
    pin.ids.push(...pick(object, ID_KEYS, (v) => UUID.test(v)).map((v) => v.toLowerCase()));
    pin.owners.push(...pick(object, OWNER_KEYS, (v) => UUID.test(v)).map((v) => v.toLowerCase()));
    // 사본 내용은 사본 칸(backup 등) 안에 있을 때만 대조합니다(맨 위의 title·body는 메모 수정 모양과 겹치므로 읽지 않음).
    if (nested) {
      for (const v of pick(object, TITLE_KEYS, (s) => s.length <= TEXT_MAX)) titles.add(v);
      for (const v of pick(object, CONTENT_KEYS, (s) => s.length <= TEXT_MAX)) contents.add(v);
    }
  }
  pin.keys = pin.keys.slice(0, 30);
  pin.inconsistent = titles.size > 1 || contents.size > 1;
  if (titles.size === 1) pin.title = [...titles][0];
  if (contents.size === 1) pin.content = [...contents][0];
  return pin;
}

// 대조에 쓸 값이 하나라도 있었는지(감사 기록용).
export function hasPin(pin) {
  return pin.ids.length > 0 || pin.owners.length > 0 || pin.title !== null || pin.content !== null;
}

// DB 함수에 넘길 사본 내용 대조 값(없으면 null).
export function expectedCopy(pin) {
  const out = {};
  if (pin.title !== null) out.title = pin.title;
  if (pin.content !== null) out.content = pin.content;
  return Object.keys(out).length ? out : null;
}

// 서버가 바로 볼 수 있는 대조: id는 주소의 id와 같아야 하고, 내용 값끼리 서로 모순되면 안 됩니다.
// 소유자 값은 여기서 복원을 막는 데 쓰지 않습니다: 요청에 실린 소유자 값이 로그인 계정 번호와 다른 체계의 이름(가명 ID 등)일 수 있어
// 같은 사람인데도 정상 복구를 막을 수 있기 때문입니다. 소유자는 어차피 로그인 토큰으로 확인된 사용자와 사본의 소유자가 같은 행만 복원됩니다(DB 함수).
export function pinConflicts(pin, { id }) {
  return pin.inconsistent || pin.ids.some((value) => value !== id);
}
