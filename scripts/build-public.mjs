import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
  throw new Error('aleph.config.json의 step을 확인해 주세요.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
// 5단계부터 로그인은 서버 함수(/api/auth/…)가 하므로 브라우저에 Supabase SDK 파일을 내보내지 않습니다.
// 이전 빌드가 남긴 복사본이 있으면 지웁니다(Git에 올라가지 않는 폴더).
await rm(resolve(root, 'public', 'vendor'), { recursive: true, force: true });
if (config.step === 1) {
  const data = JSON.parse(await readFile(source, 'utf8'));
  if (!Array.isArray(data.notes)) {
    throw new Error('실습용 공개 자료 형식을 확인하세요. 실제 학생 자료를 넣으면 안 됩니다.');
  }
  await copyFile(source, output);
  console.log('실습용 공개 자료를 public/data.json에 복사했습니다.');
} else {
  // 2단계부터 자료는 서버 함수(api/notes.js)가 DB에서 읽습니다. 공개 data.json은 복사하지 않고
  // 저장소에 있는 비어 있는 public/data.json을 그대로 둡니다.
  const published = JSON.parse(await readFile(output, 'utf8'));
  if (!Array.isArray(published.notes) || published.notes.length > 0 || 'sampleMarker' in published) {
    throw new Error('public/data.json에는 메모와 확인 표시가 없어야 합니다.');
  }
  console.log('2단계 이후라 data.json을 복사하지 않았습니다. public/data.json은 비어 있습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
