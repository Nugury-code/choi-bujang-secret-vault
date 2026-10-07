// 보너스 「무차별 로그인 공격」: Wazuh 모양 경보에서 필요한 다섯 칸만 뽑는 읽기 모듈입니다.
// 뽑는 칸: 시각, 출발 주소, 계정, 규칙 수준, 설명. 그 밖의 칸은 읽지 않고 출력하지 않습니다.
// 원본 경보는 고치지 않고, 파일도 쓰지 않습니다. 경보 하나마다 정확히 한 줄을 돌려줍니다.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = '[가림]';

// 비밀값처럼 보이는 모양입니다. 앞쪽 패턴이 먼저 지우고, 마지막 두 개는 긴 무작위 문자열을 잡습니다.
const SECRET_PATTERNS = [
  /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /Bearer\s+\S+/gi,
  /(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key|apikey|authorization|비밀번호|암호|토큰|비밀키)\s*[=:]\s*\S+/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /[A-Za-z0-9_+/=-]{32,}/g,
];

// 문자열의 비밀값 모양을 가리고, 줄바꿈·탭·제어문자는 공백으로 바꿉니다(한 줄 출력 보장).
export function maskSecrets(value) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, MASK);
  return text.trim();
}

function pick(object, key) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) ? object[key] : undefined;
}

function toLevel(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 경보 하나 → 한 줄. 칸이 없거나 모양이 다르면 그 칸만 null 이고, 줄 자체는 항상 만듭니다.
export function extractAlert(alert) {
  const data = pick(alert, 'data');
  const rule = pick(alert, 'rule');
  return {
    time: maskSecrets(pick(alert, 'timestamp')),
    srcip: maskSecrets(pick(data, 'srcip')),
    account: maskSecrets(pick(data, 'srcuser')),
    level: toLevel(pick(rule, 'level')),
    description: maskSecrets(pick(rule, 'description')),
  };
}

// 경보 묶음(객체) → { alertCount, rows, lineCount, matches }.
export function readAlerts(fixture) {
  if (fixture === null || typeof fixture !== 'object' || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  const rows = fixture.alerts.map(extractAlert);
  return {
    alertCount: fixture.alerts.length,
    rows,
    lineCount: rows.length,
    matches: rows.length === fixture.alerts.length,
  };
}

export async function readAlertFile(path) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'brute-force') {
    throw new Error('brute-force 경보 묶음이 아닙니다.');
  }
  return readAlerts(fixture);
}

export function formatRow(row) {
  const cell = (value) => (value === null ? '-' : String(value));
  return [row.time, row.srcip, row.account, row.level, row.description].map(cell).join(' | ');
}

const here = dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = await readAlertFile(join(here, '..', 'fixtures', 'brute-force.json'));
    console.log('시각 | 출발 주소 | 계정 | 규칙 수준 | 설명');
    for (const row of result.rows) console.log(formatRow(row));
    console.log(`경보 ${result.alertCount}건 / 뽑은 줄 ${result.lineCount}줄 / ${result.matches ? '일치' : '불일치'}`);
    if (!result.matches) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
