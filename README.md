# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 2단계: 자료를 코드 밖으로 옮긴 상태

화면은 이제 `/data.json`이 아니라 서버 함수 `/api/notes`(`api/notes.js`)를 통해 학습용 DB의 가상 메모 네 건을 읽습니다. `data.json`과 `public/data.json`의 `notes`는 빈 배열이어서 `/data.json`을 열면 메모가 보이지 않아야 합니다. 메모 본문은 이 저장소에 두지 않습니다.

서버 함수는 Vercel 프로젝트의 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 읽습니다. 두 값은 코드, README, Git, 화면에 적지 않고 Vercel 설정 화면의 비밀 입력란에 직접 넣습니다. 서버 전용 키는 브라우저 파일, 응답, 로그에 나가지 않습니다. 테이블은 행 수준 보안(RLS)을 켜 두었고 `anon`·`authenticated`에는 읽기 권한을 주지 않았습니다(2단계 당시. 4단계에서 `authenticated`에 본인 행만 허용하는 권한과 정책을 더했고, 5단계에서 이 직접 권한을 다시 회수했습니다. 아래 4·5단계 절).

**2단계 당시의 약점(3단계에서 토큰 검사로 막음):** `/api/notes`는 공개 주소이고 로그인이 없어서 누구나 이 주소를 부르면 같은 메모를 받을 수 있었습니다. 지금은 아래 3단계 절처럼 토큰 없이 부르면 401입니다. 그래도 이 DB에는 가상 메모만 둡니다. 옛 커밋과 옛 배포에는 이전의 공개 메모가 남아 있을 수 있어서, 이번 변경만으로 과거 노출이 해소됐다고 볼 수 없습니다.

**지금 작동하는 기능:** 화면의 카드 네 개는 `/api/notes`에서 오고, 공개 `/data.json`은 `"notes": []`뿐이며, `aleph.config.json`의 `step`은 2단계 당시 2였고, 3단계에서 3, 지금은 4입니다. 2단계부터 `npm run build`는 `data.json`을 `public`으로 복사하지 않고 비어 있는 `public/data.json`만 검사합니다.

**다시 실행하는 방법:**

1. `npm install`을 한 번 실행합니다.
2. 시험은 `npm run test:r5`, `npm run test:package`, `npm run test:notes`입니다.
3. 제출 묶음은 `npm run bundle`로 만들고, `bundle-notes.json`(커밋하지 않음)에 이번 단계에서 한 일을 적어 둡니다. 점검(`src/attack-check.mjs`)은 배포 주소의 `/data.json`(메모 0건, 확인 표시 없음)과 로그인 없는 `/api/notes`(건수와 상태만 기록, 메모 본문은 기록하지 않음)를 실제로 요청해서 결과를 적고, 요청하지 못한 항목은 "확인하지 못함"으로 남깁니다.
4. Windows에서 `spawnSync git ENOENT`가 나오면 터미널이 `git`을 못 찾는 것이므로 그 터미널의 PATH에 Git 경로를 넣고 다시 실행합니다.

서버 함수가 실제로 네 카드를 내려 주는지는 환경변수를 넣고 다시 배포한 뒤 화면에서 확인합니다.

### 가상 메모 문장 검색 확인 절차

2단계 뒤에는 현재 배포 파일과 GitHub 최신 파일에 가상 메모 문장이 없어야 합니다. 아래 검색어는 메모 문장 네 개를 한 번에 찾는 정규식입니다. 검색어의 `.`는 아무 글자 하나를 뜻하고 괄호와 `|`도 들어 있어서, 이 README에는 메모 문장이 글자 그대로 이어서 적혀 있지 않으므로 검색에 걸리지 않습니다. 그대로 복사해서 쓰세요.

```
실습용.가상.(과제|포트폴리오|리추얼|행정).기록
```

1. **GitHub 최신 파일**: 저장소 폴더에서 `git pull`로 최신 `main`을 받은 뒤 `git grep -nE '실습용.가상.(과제|포트폴리오|리추얼|행정).기록' HEAD`를 실행합니다. 출력이 없으면 최신 커밋의 파일에는 문장이 없다는 뜻입니다.
2. **현재 배포 파일**: `curl https://<배포 주소>/data.json`을 실행하면 `"notes": []`처럼 메모가 비어 있어야 합니다. 첫 화면도 `curl https://<배포 주소>/ | grep -E '실습용.가상.(과제|포트폴리오|리추얼|행정).기록'`로 검색해 출력이 없어야 합니다. Windows에서는 `curl` 대신 `curl.exe`를 씁니다.
3. **공개 API는 따로 봅니다**: `https://<배포 주소>/api/notes`는 서버 함수가 DB에서 읽어 오는 곳이라 메모가 나오는 것이 정상입니다. 이 주소는 위 검색의 "없어야 하는" 대상이 아니라 아래 남은 약점으로 기록합니다.
4. **과거 노출 확인**: `git log --oneline -G '실습용.가상.(과제|포트폴리오|리추얼|행정).기록'`을 실행하면 옛 공개 커밋이 나옵니다. 나오는 한 과거 노출은 남아 있습니다.

검색 결과와 공개 API의 남은 약점은 서로 다른 항목이므로 각각 기록합니다. 아직 실행하지 않은 확인은 날짜 칸에 "미실행"이라고 적습니다.

| 기록 항목 | 확인한 날짜·커밋 | 결과 |
| --- | --- | --- |
| GitHub 최신 파일 검색 (`git grep ... HEAD`) | 2026-10-06 · 358a113 | 일치 0건 |
| 배포된 `/data.json`의 `notes` | 2026-10-06 · 358a113 | 브라우저에서 `"notes": []`로 확인 |
| 배포된 첫 화면 검색 | 2026-10-06 · 358a113 | `curl.exe`로 검색, 출력 없음 |
| 옛 커밋 검색 (`git log -G ...`) | 2026-10-06 · 358a113 | 옛 커밋 2건에 메모가 남아 있음(과거 노출은 그대로) |
| 공개 키로 `vault_notes` 직접 요청 | 2026-10-06 · 358a113 | HTTP 401, 오류 코드 42501(permission denied). 공개 키로는 표를 읽을 수 없음 |
| API `/api/notes` 토큰 검사 | 2026-10-07 | 토큰 없이 호출하면 401. 3단계 당시에는 로그인한 누구나 남의 메모 id로 읽기·수정·삭제할 수 있었고, 4단계에서 API 소유자 검사와 DB의 행 단위 보안으로 막음 |

**과거 노출은 해소됐다고 쓰지 않습니다.** 옛 공개 커밋은 Git 기록에 그대로 남고, 옛 배포는 배포별 주소에서 계속 열릴 수 있어 옛 `/data.json`을 보여 줄 수 있습니다. 이 기록들이 남아 있는 한 이전에 메모가 공개된 사실은 되돌려지지 않았고, 이번 확인은 최신 파일과 현재 배포에서 메모가 사라졌는지만 확인합니다.

### 3단계 시작: 로그인·로그아웃 화면

화면에 Supabase Auth 이메일·비밀번호 로그인과 로그아웃을 붙였습니다. 비밀번호 확인과 로그인 토큰 발급은 Supabase Auth가 하고, 이 저장소의 코드는 비밀번호나 토큰을 직접 만들거나 저장하지 않습니다.

- (3단계 당시 구조. 5단계에서 서버 함수로 옮겼습니다. 아래 "5단계 저장점" 절) `public/app.js`가 공식 SDK(`signInWithPassword`, `signOut`, `onAuthStateChange`)를 불렀고 화면에 프로젝트 주소와 공개용 키(`sb_publishable_`로 시작)가 들어 있었습니다.
- (3단계 당시) SDK 파일은 `npm run build`가 `node_modules`에서 `public/vendor/supabase.js`로 복사했습니다. 5단계부터는 SDK를 화면에서 쓰지 않아 복사하지 않고, 남아 있는 복사본은 빌드가 지웁니다.
- 로그인 실패는 화면에 이유를 보여 줍니다. 계정이 있는지 없는지는 구분해서 알려 주지 않습니다.
- 로그인하면 계정 이메일과 로그아웃 단추가, 로그아웃하면 이메일·비밀번호 입력창이 보입니다. 화면 상태는 `<body data-auth>`가 `signed-in` 또는 `signed-out`으로 바뀝니다.
- 시험 계정은 Supabase 대시보드(Authentication > Users)에서 사용자를 직접 만들어 씁니다. 화면에는 회원가입이 없습니다.
- 시험은 `npm run test:auth`입니다. 화면이 같은 사이트의 파일만 읽는지, CSP의 스타일 해시가 `index.html`과 맞는지, 비밀값이 없는지를 확인합니다. `index.html`의 `<style>`을 고치면 이 시험이 해시 불일치로 실패하니, `vercel.json`의 해시를 다시 계산해 맞춥니다.

**이 절 이후의 변화:** 이 화면 단계에서는 로그인이 신원 확인까지만이었고, 서버가 토큰을 검사하는 일은 바로 아래 절에서, 메모 추가·수정·삭제는 그 아래 절에서 붙였습니다.

### 3단계: 서버가 로그인 토큰을 검사

- `/api/notes`는 `Authorization: Bearer <토큰>`이 있는 요청만 처리합니다. 토큰은 틀이 준 `src/verify-login.mjs`(고치지 않은 도우미)로만 검사하고, 토큰이 없거나 검사에 실패하면 DB를 읽지 않고 `401`과 `{"error":"UNAUTHORIZED"}`만 돌려 줍니다.
- 브라우저가 보낸 userId·role·쿼리·본문 값은 읽지 않습니다. 사용자 정보는 검사를 통과한 토큰에서만 나옵니다.
- 화면(`public/app.js`)은 로그인한 뒤에만 토큰을 실어 자료를 요청하고, 로그아웃하면 목록을 지웁니다.
- 검사에 쓴 발급자 정보(issuer, audience, jwksUrl)는 `aleph.config.json`의 `identityProvider`에 적었습니다. 모두 공개 주소이며 비밀 키는 없습니다. 서버 키는 Vercel 환경변수 `SUPABASE_SECRET_KEY`에만 있습니다.
- 확인: 시크릿 창에서 로그인 없이는 자료가 보이지 않고(`/api/notes` 직접 열기 = 401), A 계정으로 로그인한 뒤에는 보입니다.
- 남은 약점: 3단계 당시에는 소유자 검사가 없었고 4단계에서 API에 붙였습니다(아래 "4단계" 절). 요청 횟수 제한은 없습니다.

### 3단계: 로그인한 사람이 메모를 추가·수정·삭제

서버 API 네 가지와 화면(메모 추가 칸, 각 메모의 수정·삭제 단추)을 붙였습니다. 모든 경로는 위 절의 토큰 검사(`src/verify-login.mjs`)를 먼저 통과해야 하고, 통과하지 못하면 DB를 읽거나 쓰지 않고 `401`만 돌려 줍니다. 공통 코드는 `src/notes-service.mjs`, 경로 파일은 `api/notes.js`(`/api/notes`)와 `api/notes/[id].js`(`/api/notes/:id`)입니다.

| 요청 | 하는 일 | 성공 응답 |
|---|---|---|
| `GET /api/notes` | 로그인 사용자의 메모 목록 | `200` `[{id,title,body}, …]` |
| `POST /api/notes` | 메모 추가. 본문 `{id?,title,body}` (`id`는 UUID, 없으면 서버가 만듦) | `201` `{id}` |
| `GET /api/notes/:id` | 한 건 조회 | `200` `{id,title,body}` |
| `PUT /api/notes/:id` | 수정. 본문 `{title,body}` | `200` `{id,title,body}` |
| `DELETE /api/notes/:id` | 삭제 | `200` `{id}` |

- 없는 메모(지운 뒤 포함)와 UUID 모양이 아닌 `:id`는 `404`, 제목(1~120자)·내용(5000자 이하)이 맞지 않거나 `id`가 UUID가 아니면 `400`, 이미 있는 `id`로 추가하면 `409`, 허용하지 않은 메서드는 `405`입니다.
- 메모 주인은 서버가 토큰에서 확인한 사용자 ID이며, 추가할 때 `owner_id`로 저장합니다. 브라우저가 보낸 `owner_id`·`userId`·`role`은 읽지 않고 무시합니다.
- 목록에는 내 메모만 나옵니다(4단계에서 바뀜. 3단계에는 주인이 없는 처음 가상 메모도 함께 나왔습니다).
- 허용 경로는 `aleph.config.json`의 `allowedRoutes`에 `METHOD /경로` 모양으로 적었습니다.
- 데이터 준비: 메모마다 바깥에서 쓰는 UUID가 필요해 표에 `note_id` 칸을 더합니다. Supabase SQL Editor에서 `supabase/002_note_id.sql`을 실행하고(여러 번 실행해도 안전, 기존 메모 보존), 맨 아래 확인 결과에서 `note_id_type`이 `uuid`, `notes`와 `distinct_note_ids`가 같고 `rls_on`이 `true`인지 봅니다. 서버 전용 역할에 추가·수정·삭제 권한을 주는 한 줄도 들어 있고, 확인 결과에서 `server_can_*`는 `true`, `anon_can_select`와 `authenticated_can_select`는 `false`여야 합니다. 코드를 올리기 전에 실행해야 합니다.
- 시험: `npm run test:notes`(가짜 DB로 추가·조회·수정·삭제, 401·400·404·405·409·502, 위조·만료 토큰, 브라우저가 보낸 값 무시), `npm run test:auth`.

**3단계 당시의 허점(4단계에서 API로 막음):** 서버가 메모의 주인을 검사하지 않아서, 로그인한 B가 A 메모의 `id`(UUID)를 알면 `GET`·`PUT`·`DELETE`로 읽고, 고치고, 지울 수 있었습니다. 아래 4단계 절에서 막았습니다. 요청 횟수 제한은 아직 없고, Supabase 공개 가입 설정은 점검하지 않았습니다.

### 4단계: API의 소유자 검사

모든 메모 요청에서 **로그인 토큰으로 확인된 사용자 ID**와 DB의 `owner_id`를 비교합니다. 주소·쿼리·본문·헤더에 적힌 `owner_id`·`userId`·`role`은 값으로 쓰지 않습니다. 요청 모양과 응답 모양(`GET`·`POST /api/notes`, `GET`·`PUT`·`DELETE /api/notes/:id`, 한 건 `{id,title,body}`, 수정 본문 `{title,body}`)은 그대로이고, `allowedRoutes`의 다섯 경로도 그대로입니다.

| 요청 | 소유자 규칙 | 거부될 때 |
|---|---|---|
| `GET /api/notes` | `owner_id`가 나인 메모만 목록에 나옵니다. 주인이 없거나 남의 메모는 나오지 않습니다. | (빈 목록) |
| `POST /api/notes` | 서버가 확인한 내 ID를 `owner_id`로 저장합니다. 본문의 `owner_id`는 무시합니다. 남의 메모와 같은 `id`로는 덮어쓰지 못합니다. | `409` |
| `GET /api/notes/:id` | `note_id`가 같고 `owner_id`가 나인 행만 돌려줍니다. | `404` |
| `PUT /api/notes/:id` | 기존 행의 `owner_id`가 나여야 하고, 저장하는 새 행의 `owner_id`도 나로 고정합니다. 본문에 내가 아닌 ID가 `owner_id` 등으로 적혀 있으면 소유자 변경 시도로 보고 거부합니다. | `404`(남의 메모), `403`(소유자 변경 시도) |
| `DELETE /api/notes/:id` | `note_id`가 같고 `owner_id`가 나인 행만 지웁니다. | `404` |

- 남의 메모와 없는 메모는 모두 같은 `404`로 답해서, 메모 번호가 실제로 있는지도 알려 주지 않습니다.
- 소유자 조건을 SQL 한 문장 안에 넣었습니다("확인한 뒤 실행"이 아니라 `where note_id = … and owner_id = 내 ID`). 그래서 확인과 실행 사이에 끼어들 틈이 없고, DB가 돌려준 행의 `owner_id`도 코드에서 한 번 더 비교합니다.
- 주인이 비어 있는 메모는 아무도 읽거나 고치거나 지울 수 없습니다. 기존 가상 메모 4건은 SQL로 A에게 연결했고, B 시험 메모 1건이 있습니다.
- 시험: `npm run test:notes`에 A·B 각자의 추가·조회·수정·삭제, B가 A의 메모를 읽기·수정·삭제하려는 시도, 소유자 변경 시도, 심판 신원 메모와의 분리가 들어 있습니다. 검사 줄을 일부러 빼면 해당 시험이 실패하는 것도 확인했습니다.
- **DB의 두 번째 방어선:** 이 검사는 서버 코드에 있고, DB에도 같은 규칙을 한 겹 더 두었습니다(아래 "4단계 저장점" 절). 그래도 서버 키(`SUPABASE_SECRET_KEY`)로 DB를 부르면 DB의 행 단위 보안은 적용되지 않고 이 서버 코드의 검사만 남으므로, 서버 키는 계속 비밀로 둡니다. (5단계에서 `authenticated`의 직접 권한은 회수했고 정책만 남겨 두었습니다. 아래 "5단계 저장점" 절.)

### 보안 응답 헤더

`vercel.json`의 `headers`가 모든 응답에 아래 네 헤더를 붙입니다. 첫 화면 응답에서 `curl.exe -I https://<배포 주소>/`로 확인합니다.

- `X-Content-Type-Options: nosniff`: 브라우저가 파일 종류를 멋대로 추측해 실행하지 못하게 합니다.
- `X-Frame-Options: DENY`: 다른 사이트가 이 화면을 프레임으로 끼워 넣는 것을 막습니다.
- `Referrer-Policy: strict-origin-when-cross-origin`: 다른 사이트로 이동할 때 주소 정보가 새는 것을 줄입니다.
- `Content-Security-Policy`: 스크립트는 같은 사이트 파일만(`script-src 'self'`), 스타일은 `index.html`의 `<style>` 하나를 해시로만 허용하고, 연결은 같은 사이트와 Supabase 프로젝트 주소만 허용하며, 프레임 삽입을 막습니다.

**주의:** `index.html`의 `<style>` 안쪽을 한 글자라도 바꾸면 스타일이 적용되지 않으므로, 고친 뒤에는 해시를 다시 계산해 `vercel.json`에 맞춥니다(`npm run test:auth`가 어긋남을 알려 줍니다). 스크립트는 `public/app.js` 파일이라 고쳐도 해시가 필요 없습니다. 화면이 이상하면 `vercel.json`을 직전 커밋으로 되돌립니다.

### 3단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

**지금 작동하는 기능** (실제 배포 주소에서 확인한 것은 괄호에 적었습니다)

- 이메일·비밀번호 로그인과 로그아웃 화면(Supabase Auth 공식 SDK). 로그아웃하면 목록과 메모 추가 칸이 숨겨집니다.
- 서버가 모든 자료 요청의 로그인 토큰을 `src/verify-login.mjs`로 검사합니다. 토큰이 없거나 위조·만료·다른 서비스용이면 자료 없이 `401`입니다(토큰 없이 `GET /api/notes`, `GET /api/notes/:id`, `POST /api/notes` 모두 401 확인).
- 로그인한 A가 메모를 추가·수정·삭제하고, 지운 뒤 한 건 조회는 `404`입니다(A 계정으로 화면에서 확인). 추가한 메모의 주인(`owner_id`)은 서버가 확인한 사용자 ID입니다.
- 처음 가상 메모 4건은 DB에 그대로 있고, 공개 `/data.json`은 `"notes": []`입니다. 보안 응답 헤더 네 개가 붙어 있습니다.
- `aleph.config.json`: `step` 3, `identityProvider`(발급자·대상·공개키 주소, 비밀 없음), `allowedRoutes`(`GET`·`POST /api/notes`, `GET`·`PUT`·`DELETE /api/notes/:id`).

**다시 실행하는 방법**

1. `npm install`을 한 번 실행합니다.
2. 시험: `npm run test:r5`, `npm run test:package`, `npm run test:notes`, `npm run test:auth`. 모두 통과해야 합니다.
3. DB: Supabase SQL Editor에서 `supabase/vault_notes.sql`(표 구조와 권한)과 `supabase/002_note_id.sql`(메모 UUID 칸과 서버 쓰기 권한)을 순서대로 실행합니다. 둘 다 여러 번 실행해도 안전하며, 가상 메모 자료는 저장소에 두지 않습니다.
4. Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`는 Vercel 설정의 비밀 입력란에만 넣습니다. 그 뒤 `git push`로 배포합니다.
5. 제출 묶음: 모든 변경을 커밋한 뒤 `npm run bundle`을 실행합니다(`bundle-notes.json`은 커밋하지 않고, `artifacts/submission.json`도 커밋하지 않습니다). 직접 점검(`src/attack-check.mjs`)이 배포 주소에 로그인 없이 보낼 수 있는 요청만 실제로 보내고 결과 상태 코드를 적습니다: 공개 `/data.json`, 토큰 없는 목록 읽기·메모 추가·수정·삭제, 위조·만료 모양·다른 서비스용 모양의 가짜 토큰.
6. 직접 점검이 보내지 않는 것(미실행): 정상 A 로그인 뒤 요청과, 진짜로 서명된 만료 토큰·다른 서비스용 토큰은 로그인 정보가 필요해 이 점검에서 보내지 않습니다. 이 항목은 `npm run test:notes`의 가짜 서명 키 시험으로만 확인했습니다.

**3단계 저장점 당시에 막지 못했던 것(소유자 검사는 4단계에서 API에 붙임):** 로그인한 B가 A 메모의 `id`를 알면 읽고·고치고·지울 수 있었습니다. 요청 횟수 제한이 없고, Supabase 공개 가입 설정은 점검하지 않았습니다. `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny` 하나(모든 요청을 거부하는 기본 규칙)뿐이며 이 단계에서 새 규칙을 만들지 않았습니다.

### 4단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

**지금 작동하는 기능** (실제 배포 주소와 Supabase에서 확인한 것은 괄호에 적었습니다)

- 3단계 기능은 그대로입니다: 로그인·로그아웃 화면, 서버의 로그인 토큰 검사(없거나 위조·만료·다른 서비스용이면 `401`), 로그인한 사람의 메모 추가·수정·삭제, 공개 `/data.json`은 `"notes": []`, 보안 응답 헤더 네 개.
- **API의 소유자 검사:** 서버가 확인한 사용자 ID와 DB의 `owner_id`를 읽기·추가·수정·삭제마다 비교합니다. 규칙은 위 "4단계: API의 소유자 검사" 절의 표와 같습니다. 남의 메모와 없는 메모는 `404`, 소유자 변경 시도는 `403`입니다(B 계정으로 A가 새로 추가한 시험 메모의 `id`에 `GET`·`PUT`·소유자를 바꾼 `PUT`·`DELETE`를 보내 `404`·`404`·`403`·`404`를 받았고, A 화면에서 그 메모가 그대로 남아 있음을 확인. A·B 화면에서 각자 자기 메모만 보임).
- **DB의 행 단위 보안(`vault_notes` 표만):** 기존 권한을 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`로 모두 회수한 뒤 `authenticated`에만 `SELECT`·`INSERT`·`UPDATE`·`DELETE`를 줬습니다. 행 단위 보안은 켜져 있고 정책은 네 개입니다: `vault_notes_select_own`·`vault_notes_delete_own`은 기존 행 `USING`, `vault_notes_insert_own`은 새 행 `WITH CHECK`, `vault_notes_update_own`은 기존 행 `USING`과 새 행 `WITH CHECK`이며, 모두 대상이 `authenticated`이고 조건은 `(select auth.uid()) = owner_id`입니다. 그래서 로그인한 사용자가 서버 API를 거치지 않고 Supabase 데이터 API를 직접 불러도 자기 행만 보고 바꿀 수 있었습니다(이 직접 권한은 5단계에서 다시 회수함. Supabase에서 `anon`은 `has_table_privilege` 기준 권한 없음, `authenticated`는 네 가지뿐, 정책 네 개, `anon`·`PUBLIC`의 열 단위 권한 0개를 조회로 확인). 서버 API가 쓰는 `service_role`은 행 단위 보안을 건너뛰는 서버 전용 역할이라 건드리지 않았습니다(Supabase 기본 권한으로 `TRUNCATE`·`REFERENCES`·`TRIGGER`도 붙어 있음).
- `aleph.config.json`: `step` 4, `identityProvider`와 `allowedRoutes`(다섯 경로)는 3단계와 같고 실제 메서드·경로와 맞습니다.

**다시 실행하는 방법**

1. `npm install`을 한 번 실행합니다.
2. 시험: `npm run test:r5`, `npm run test:package`, `npm run test:notes`, `npm run test:auth`. 모두 통과해야 합니다. `test:notes`에는 A·B 각자의 추가·조회·수정·삭제와 B의 접근 거부(`404`·`403`)가 들어 있습니다.
3. DB: 표 구조와 서버 쓰기 권한은 `supabase/vault_notes.sql`, `supabase/002_note_id.sql`을 순서대로 실행합니다. 4단계의 행 단위 보안은 Supabase SQL Editor에서 직접 실행했고 **이 SQL 파일은 저장소에 두지 않았습니다.** 다시 만들 때는 위 규칙대로 `REVOKE ALL`, `GRANT`, 정책 네 개(`CREATE POLICY`, 같은 이름)를 같은 순서로 실행하고, `information_schema.role_table_grants`·`has_table_privilege`·`pg_policies`로 결과를 대조합니다.
4. 직접 확인: 시크릿 창은 여러 개를 열어도 로그인 정보를 같이 쓰므로 A와 B를 서로 다른 브라우저로 나누거나, 한 창에서 로그아웃·로그인을 번갈아 합니다. A가 시험 메모를 새로 추가한 뒤(처음 가상 메모로는 시험하지 않습니다), 그 메모의 `id`로 B가 읽기·수정·소유자 변경·삭제를 시도해 `404`·`404`·`403`·`404`가 나와야 하고 A의 메모는 그대로여야 합니다.
5. 제출 묶음: 변경을 커밋한 뒤 `npm run bundle`을 실행합니다(`bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않습니다). 직접 점검(`src/attack-check.mjs`)은 배포 주소에 로그인 없이 보낼 수 있는 요청 여덟 개(공개 `/data.json`, 토큰 없는 목록 읽기·메모 추가·수정·삭제, 위조·만료 모양·다른 서비스용 모양의 가짜 토큰)만 실제로 보내고 상태 코드를 적습니다. 서명된 A·B 로그인 토큰이 필요한 "A·B가 서로의 메모에 접근하지 못함"은 이 점검에서 보내지 않았으므로 `미실행`으로 한 항목을 적습니다.

**4단계 저장점 당시에 막지 못했던 것·미확인:** 요청 횟수 제한이 없습니다. Supabase 공개 가입 설정은 점검하지 않았습니다. 서버 키가 새면 행 단위 보안을 건너뛰어 모든 메모를 읽고 지울 수 있습니다(서버 키는 Vercel 비밀 입력란에만 둡니다). `authenticated`가 데이터 API로 자기 행을 직접 쓰면 API의 입력 검사(제목·내용 길이, UUID 모양)는 거치지 않습니다(자기 행에 한정). 옛 커밋과 옛 배포에는 이전 자료가 남아 있을 수 있습니다. 심판이 남의 메모 접근에 `404`를 받아들이는지, 적용 전 `anon`·`authenticated` 권한 표를 받지 못해 적용 전후 대조는 완성하지 못한 점도 확인하지 못했습니다. 화면 위쪽의 낡은 문구("서버 보호가 아직 없는 상태" 등)는 아직 고치지 않았습니다. `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny` 하나뿐이며 이 단계에서 새 규칙을 만들지 않았습니다.

### 5단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

**지금 작동하는 기능** (실제 배포 주소와 Supabase에서 확인한 것은 괄호에 적었습니다)

- 4단계까지의 기능은 그대로입니다: 로그인·로그아웃, 서버의 로그인 토큰 검사(`401`), 로그인한 사람의 메모 추가·수정·삭제, API의 소유자 검사(남의 메모 `404`, 소유자 변경 시도 `403`), 보안 응답 헤더 네 개, 공개 `/data.json`은 `"notes": []`.
- **자료 요청은 서버 함수 한 곳으로 모읍니다.** 브라우저 코드(`public/app.js`, `public/index.html`)에는 Supabase 주소도 공개 키도 SDK도 없습니다. 로그인·토큰 갱신·로그아웃은 `POST /api/auth/login`·`/api/auth/refresh`·`/api/auth/logout`(`src/auth-service.mjs`)이 대신 Supabase Auth에 요청하고, 메모 읽기·추가·수정·삭제는 같은 사이트의 `/api/notes`, `/api/notes/:id`로만 보냅니다(코드 검색과 시험으로 확인).
- **로그인은 서버 함수가 합니다.** 공개 키는 서버 환경변수 `SUPABASE_PUBLISHABLE_KEY`에서만 읽습니다(Vercel에 직접 넣어야 하며 값은 저장소에 두지 않습니다). 비밀번호는 서버가 Supabase에 전달만 하고 저장·기록하지 않습니다. 오래 사는 갱신 토큰은 JavaScript가 읽을 수 없는 쿠키(`byteback_rt`, `HttpOnly`·`Secure`·`SameSite=Strict`, 경로 `/api/auth`)에만 있고, 화면은 짧게 사는 접근 토큰만 이 페이지 메모리에 둡니다(저장소·쿠키에 쓰지 않음). 접근 토큰이 끝나면 화면이 한 번 자동으로 갱신해 다시 시도하고, 새로고침해도 쿠키로 로그인이 이어집니다. 다른 사이트가 보낸 요청(`Origin`이 이 사이트가 아님)은 `403`으로 거부합니다.
- **요청 횟수 제한(두 겹).** (1) 서버 함수 인스턴스 메모리에서 세는 제한: 메모 API는 같은 IP에서 1분에 300번(로그인 토큰 검사 전), 로그인 쿠키가 없는 갱신 요청도 같은 방식. (2) DB에서 세는 제한(모든 인스턴스가 같은 숫자를 봄, `supabase/003_rate_limits.sql`): 로그인은 같은 IP 10분에 20번·같은 이메일 10분에 8번, 갱신은 IP 10분에 120번, 메모 추가·수정·삭제는 사용자별 1분에 60번. 넘으면 `429 {"error":"RATE_LIMITED"}`와 `Retry-After`를 돌려줍니다. 제한 키는 IP·이메일·사용자 ID를 서버 키로 해시한 값만 DB에 저장합니다. DB 제한이 오류(함수가 아직 없거나 DB 장애)이면 메모리 제한만으로 계속 처리하고 오류 코드만 로그에 남깁니다(요청을 막지 않는 쪽으로 실패). 한도 숫자는 `src/auth-service.mjs`의 `LIMITS`, `src/notes-service.mjs`의 `NOTES_LIMITS`에서 조정합니다.
- **DB의 직접 권한을 회수했습니다(`vault_notes` 표만).** `PUBLIC`·`anon`·`authenticated`의 권한을 모두 거두고 `service_role`(서버 함수가 서버 전용 설정으로 쓰는 역할)만 남겼습니다. 행 단위 보안은 켜 둔 채 정책 네 개(`authenticated` 대상, `auth.uid() = owner_id`)는 지우지 않고 남겨 두었습니다. 권한이 없는 동안에는 쓰이지 않고, 실수로 권한이 다시 생겨도 본인 행만 허용하는 안전장치가 됩니다(Supabase에서 적용 전후 조회: 적용 전 `authenticated` = SELECT·INSERT·UPDATE·DELETE, 적용 후 `anon`·`authenticated` 모두 권한 없음, 권한표에는 `service_role`만 남음, 열 단위 권한 18개에서 0개, 번호표(시퀀스) 권한은 전후 모두 없음, 행 단위 보안 켜짐 유지, 정책 4개 유지).
- **원본 자료 API 주소를 기록했습니다.** `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 `https://<프로젝트>.supabase.co/rest/v1/vault_notes`이며, `step`은 5입니다. `identityProvider`와 `allowedRoutes`(다섯 경로)는 4단계와 같고 실제 메서드·경로와 맞습니다. `restoreRoute`는 아직 비어 있습니다. 심판은 배포된 `/aleph.json`에서 이 주소를 읽으므로, 빌드(`scripts/deployment-identity.mjs`)가 5단계부터 `originalApiUrl`을 `/aleph.json`에 함께 기록합니다(쿼리·해시·계정 정보가 있거나 HTTPS가 아니면 빌드가 멈춥니다). 설정 파일에만 적고 이 기록이 빠지면 심판이 `S05_ORIGINAL_URL_MISSING`으로 거절합니다.
- 공개 키(`anon`)로 원본 경로를 직접 `GET`(쿼리 없이와 `?select=id`)·`PATCH`·`DELETE`·`POST`로 부르면 모두 `401`과 권한 오류 코드 `42501`이고 자료는 내려오지 않습니다(앱 안 브라우저에서 보낸 실제 요청으로 확인. 일치하는 행이 없는 조건으로만 보냈습니다). 화면에서 A 로그인으로 메모 읽기·추가·수정·삭제는 권한 회수 뒤에도 됩니다(사용자 확인).

**다시 실행하는 방법**

1. `npm install`을 한 번 실행합니다.
2. 시험: `npm run test:r5`(8개), `npm run test:package`(3개), `npm run test:notes`(21개), `npm run test:auth`(4개), `npm run test:authapi`(9개), `npm run test:limit`(6개). 모두 통과해야 합니다.
3. DB의 직접 권한 회수는 Supabase SQL Editor에서 직접 실행했고 **이 SQL 파일은 저장소에 두지 않았습니다.** 다시 만들 때는 아래 두 문장을 한 번에 실행하고, 실행하기 **전에** 먼저 권한을 조회해 기록해 둡니다(전 조회, 변경, 후 조회 순서).

```sql
begin;
alter table public.vault_notes enable row level security;
revoke all on table public.vault_notes from public, anon, authenticated;
commit;
```

   조회는 `information_schema.role_table_grants`, `has_table_privilege`(`anon`·`authenticated`·`service_role`), `information_schema.column_privileges`, `pg_policies`로 합니다. 적용 뒤에는 화면에서 A 로그인으로 메모를 읽고 추가·수정·삭제해 서버 함수 경로가 그대로 되는지 봅니다.
4. 제출 묶음: 변경을 커밋한 뒤 `npm run bundle`을 실행합니다(`bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않습니다). 5단계부터 `originalApiUrl`(HTTPS)이 없으면 묶음이 만들어지지 않습니다. 직접 점검(`src/attack-check.mjs`)은 배포 주소에 실제로 요청을 보냅니다: 공개 `/data.json`, 로그인 없는 요청 여섯 개(목록 읽기·메모 추가·수정·삭제, 위조·만료 모양·다른 서비스용 모양의 가짜 토큰은 세 개로 따로), **공개 키로 원본 자료 API를 직접 조회·수정**(공개 키는 화면 파일에 없으므로 점검을 실행하는 창에서 환경변수 `SUPABASE_PUBLISHABLE_KEY`를 줄 때만 보내고, 없으면 `미실행`으로 적습니다. 수정은 일치하는 행이 없는 조건으로만 보내 자료를 바꾸지 않음), **공개 파일 세 개(`/`, `/app.js`, `/data.json`)에서 서버 전용 키 모양·Supabase 공개 키 모양·로그인 토큰 모양·가상 메모 확인 표시 검색**. 결과에는 상태 코드와 찾았는지 여부만 적고 키 값은 적지 않습니다. 서명된 A·B 로그인 토큰이 필요한 "A·B가 서로의 메모에 접근하지 못함"과, 로그인한 시험 계정 토큰으로 원본 API를 직접 부르는 요청은 보내지 않으며 앞의 것은 `미실행`으로 한 항목을 적습니다. 심판은 저장소의 설정 파일이 아니라 배포된 `/aleph.json`을 읽으므로, 빌드가 `originalApiUrl`(5단계부터)과 `allowedRoutes`·`identityProvider`(3단계부터)를 거기에 함께 기록합니다.

**배포 순서(처음 한 번, 이 순서를 지킵니다)**

1. Vercel 프로젝트 설정 → Environment Variables에 `SUPABASE_PUBLISHABLE_KEY`(Supabase 대시보드의 공개 키 `sb_publishable_…`)를 Production에 추가합니다. 이 값이 없으면 로그인이 `500 SERVER_NOT_CONFIGURED`로 실패합니다.
2. Supabase SQL Editor에서 `supabase/003_rate_limits.sql`을 실행합니다(표와 함수만 새로 만들고 기존 메모 표는 건드리지 않습니다). 실행 전후 확인: `anon`·`authenticated`는 표와 함수를 쓸 수 없고 `service_role`만 쓸 수 있어야 합니다.
3. 변경을 커밋·Push해서 다시 배포합니다(환경변수는 새 배포부터 적용됩니다).
4. 확인: 사이트에서 로그인·새로고침·로그아웃, 배포된 `/aleph.json`에 `allowedRoutes`·`originalApiUrl`이 보이는지.

**5단계 저장점 당시에 막지 못했던 것·미확인:** 요청 횟수 제한은 로그인·갱신·메모 쓰기·IP별 요청에 걸었지만, 메모 개수 제한과 계정 잠금(여러 번 틀린 계정의 일시 정지)은 없고 인스턴스 메모리 제한은 인스턴스마다 따로 셉니다. Supabase 공개 가입 설정은 점검하지 않았습니다. 로그인 쿠키 방식은 실제 배포에서의 Safari·모바일 브라우저 동작을 확인하지 못했습니다. `service_role`에는 Supabase 기본 권한(`TRUNCATE`·`REFERENCES`·`TRIGGER` 포함)이 남아 있고, 서버 키가 새면 DB의 행 단위 보안을 건너뛰어 모든 메모를 읽고 지울 수 있습니다(서버 키는 Vercel 비밀 입력란에만 둡니다). 옛 커밋과 옛 배포에는 이전 자료가 남아 있을 수 있습니다. 심판이 남의 메모 접근에 `404`를 받아들이는지, 심판의 5단계 판정은 확인하지 못했습니다. 화면 위쪽 문구("5단계 로그인 화면", "로그인한 사람만 자기 메모를 볼 수 있습니다")와 안내문은 지금 상태에 맞게 고쳤습니다(`public/index.html`의 글자만 바꿨고 `<style>`은 그대로라 보안 헤더의 해시는 바뀌지 않습니다). `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny` 하나뿐이며 이 단계에서 새 규칙을 만들지 않았습니다.

### 이번 단계 변경 때문에 동작이 깨졌을 때 되돌리는 방법

마지막으로 정상 동작을 확인한 커밋은 `a99409f`(원본 자료 경로 기록. 배포된 `/aleph.json`이 이 커밋으로 나오고, 직접 권한 회수 SQL 적용 뒤에도 A 로그인으로 메모 읽기·추가·수정·삭제가 되고, 공개 키로 원본 자료 API를 직접 조회·수정·삭제·추가하면 401과 권한 오류 코드 `42501`, 로그인 없는 요청은 401)입니다. 그보다 앞서 4단계 저장점까지 확인한 커밋은 `1a81884`(4단계 판정 100점), 소유자 검사까지 확인한 커밋은 `60a3f7b`, 3단계 저장점까지 확인한 커밋은 `2afe0c2`, 메모 추가·수정·삭제까지 확인한 커밋은 `ae82841`, 화면과 헤더만 확인한 커밋은 `e277619`입니다. 깨졌다면 아래 순서로 되돌립니다. `git reset --hard`는 쓰지 않습니다.

1. `git status`와 `git diff`로 이번 단계 변경과 다른 변경을 먼저 구분합니다.
2. 문제를 만든 커밋만 `git revert <커밋>`으로 되돌립니다. 기록을 지우지 않고 되돌리는 새 커밋이 생깁니다.
3. 배포는 Vercel의 Deployments에서 직전에 정상이던 배포를 Instant Rollback으로 되돌릴 수 있습니다.
4. Supabase 표와 그 안의 자료는 지우거나 바꾸지 않습니다. 코드만 되돌립니다.
5. 1단계 시점으로 코드를 되돌리면 공개 `data.json`에 가상 메모가 다시 들어갈 수 있으니, 되돌린 뒤 `/data.json`의 `notes`가 비어 있는지 다시 확인합니다.

## 보너스 xdr-01 저장점: 무차별 로그인 공격(brute-force)

5단계까지의 사이트와는 별개인 보너스 작전 「무차별 로그인 공격을 잡아 냅니다」의 `xdr/brute-force/` 폴더입니다. 경보는 수업용 가상 자료(문서용 주소 대역, `user01` 같은 계정)이고 실제 로그가 아닙니다.

**현재 작동하는 것**

| 파일 | 하는 일 |
|---|---|
| `xdr/brute-force/read-alerts.mjs` | 경보에서 시각·출발 주소·계정·규칙 수준·설명 다섯 칸만 뽑습니다. 비밀값처럼 보이는 값은 `[가림]`으로 바꾸고, 원본은 고치지 않습니다. |
| `xdr/brute-force/patterns.json` | 알려진 형태 두 가지(짧은 시간 같은 주소의 로그인 실패 연속, 여러 계정에 같은 비밀번호 대입)와 근거(MITRE ATT&CK T1110.001·T1110.003)를 적었습니다. |
| `xdr/brute-force/decide.mjs` | `decide(alert)`가 `block`·`alert`·`record` 중 하나와 확신도·근거 패턴 이름을 돌려줍니다. 실패 30건 이상 또는 계정 8개 이상이면서 규칙 수준 10 이상이면 바로 `block`, 맞는 패턴이 없고 수준 4 이하면 바로 `record`, 나머지 애매한 경보만 Jev(확신도를 내는 내부 함수 `askJev`)에게 물어 0.85 이상 `block`, 0.5 이상 `alert`, 그 아래 `record`입니다. 답이 없거나 3초가 지나거나 0~1 숫자가 아니면 `alert`입니다. 이 기준 숫자는 경보 묶음을 보고 내가 정한 값이며 외부 근거가 없습니다. |
| `xdr/brute-force/connect-decider.mjs` | `block` 판정만 거부 규칙(만료 시각 30분, 근거 경보 번호)으로 만들어 `xdr/deny-rules.json`에 저장하고, `block`·`alert` 판정을 `xdr/alerts.log`에 한 줄씩 쌓습니다. 정상 경보와 같은 주소이거나 사내·루프백 주소이면 규칙을 만들지 않습니다. |

**다시 실행하는 방법**(저장소 폴더에서)

- `npm run xdr:run -- brute-force` — `xdr/brute-force/result.json`을 만듭니다. 연습 경보 28건 기준 `counts`는 `block` 10, `alert` 9, `record` 9입니다. 정상 이벤트를 `block`한 경우는 없었습니다(설명 문장과 규칙 수준으로 내가 확인했고, 정답 표가 없어 심판의 정답과 같은지는 미확인).
- `node xdr/brute-force/read-alerts.mjs` — 뽑은 줄과 "경보 28건 / 뽑은 줄 28줄 / 일치"를 보여 줍니다.
- `node xdr/brute-force/connect-decider.mjs` — 규칙·알림 로그를 만들고 경보를 다시 흘려 "막힘 10건 / 판정기로 넘김 18건"을 보여 줍니다. 두 번째 실행에서는 알림 로그가 늘지 않고, 유효한 규칙의 만료 시각도 늘지 않습니다.

**판정기와의 관계**

`src/decider.mjs`와 `RULE_IDS`(`starter.deny` 하나)는 고치지 않았습니다. 판정기 요청 계약에는 출발 주소가 없어서, 거부 규칙은 주소를 요청 밖의 인자로 받는 별도 모듈(`evaluateRequest`)에 있습니다. 실제 판정기 호출 경로에는 연결하지 않았고, 연결 여부는 미확인입니다.

**커밋하는 결과 파일**

`result.json`과 `alerts.log`는 연습 경보에서 나온 가상 자료라 커밋합니다. `deny-rules.json`은 만료 시각이 붙은 실행 상태라 커밋하지 않습니다(실행하면 다시 만들어집니다).

**이 저장점에서 막지 못했던 것·미확인:** 거부 규칙이 주소 전체에 걸려, 같은 공인 주소를 쓰는 정상 사용자가 30분 동안 막힐 수 있습니다. `decide.mjs`는 설명에 "성공"이 있어도 실패 건수와 수준이 크면 `block`합니다. 이유 코드 `xdr_brute_force_block`은 운영 등록부에 없고 실제 엔진의 동작은 확인하지 못했습니다. Jev가 무엇인지(저장소·프로젝트 문서 어디에도 설명이 없음)와 실제 호출 방법은 확인하지 못했습니다. IPv6와 규칙 파일의 무결성 검사는 없습니다. 사용자 PC에서 세 명령을 실행해 정상 출력을 확인했습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
