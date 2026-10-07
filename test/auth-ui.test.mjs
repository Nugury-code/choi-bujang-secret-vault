import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
// Windows에서 받은 폴더는 줄바꿈이 CRLF일 수 있지만, Git에 올라가 배포되는 파일은 LF라서 LF 기준으로 해시를 계산합니다.
const html = (await read('public/index.html')).replaceAll('\r\n', '\n');
const appJs = (await read('public/app.js')).replaceAll('\r\n', '\n');
const vercel = JSON.parse(await read('vercel.json'));
const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;

test('화면은 같은 사이트의 SDK와 app.js만 불러오고 인라인 스크립트를 쓰지 않는다', () => {
  assert.match(html, /<script src="\/vendor\/supabase\.js"><\/script>/u);
  assert.match(html, /<script src="\/app\.js" type="module"><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/u);
  assert.doesNotMatch(html, /https?:\/\/(?:cdn|unpkg|esm)/iu);
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/iu);
});

test('CSP의 스타일 해시가 index.html의 style 내용과 일치하고 안전하지 않은 허용이 없다', () => {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)];
  assert.equal(styles.length, 1);
  const hash = `'sha256-${createHash('sha256').update(styles[0][1], 'utf8').digest('base64')}'`;
  assert.ok(csp.includes(`style-src ${hash}`), 'index.html의 style을 고쳤다면 vercel.json의 해시를 다시 계산하세요.');
  assert.match(csp, /script-src 'self'(?:;|$)/u);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/u);
  assert.match(csp, /connect-src 'self' https:\/\/hphdsuxmehoshbcdyjvc\.supabase\.co/u);
});

test('로그인 코드는 공식 SDK 흐름만 쓰고 공개용 값만 담는다', () => {
  assert.match(appJs, /signInWithPassword/u);
  assert.match(appJs, /\.signOut\(/u);
  assert.match(appJs, /onAuthStateChange/u);
  assert.match(appJs, /SUPABASE_URL = 'https:\/\/hphdsuxmehoshbcdyjvc\.supabase\.co'/u);
  assert.match(appJs, /sb_publishable_[A-Za-z0-9_-]+/u);
  for (const text of [html, appJs]) {
    assert.doesNotMatch(text, /sb_secret_|service_role|SUPABASE_SECRET_KEY/u);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/u);
    assert.doesNotMatch(text, /innerHTML|document\.write|eval\(/u);
  }
  assert.doesNotMatch(appJs, /localStorage\.setItem|sessionStorage\.setItem|document\.cookie/u);
});

test('로그인 실패 이유 문구가 화면에 들어간다', () => {
  assert.match(appJs, /이메일 또는 비밀번호가 맞지 않습니다/u);
  assert.match(appJs, /errorBox\.textContent = message/u);
});
