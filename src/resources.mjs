// 8단계: 자료실의 자원(메모, 강사 공지)에 서버가 구별할 수 있는 자원 ID를 붙입니다.
// - 자원 ID는 요청의 "주소 모양"으로만 정합니다. 본문·쿼리·헤더의 값은 읽지 않습니다.
// - 구역(zone)은 student(학생 자료)와 instructor(강사 자료) 두 가지입니다.
// - 강사 공지(instructor.notice)는 이름만 먼저 등록했고 아직 이 서버에 공지 API와 화면은 없습니다.
// 이 파일은 다른 파일을 읽지 않고, 기존 주소도 바꾸지 않습니다.
export const RESOURCES = Object.freeze({
  'student.note': Object.freeze({ zone: 'student', routes: ['/api/notes', '/api/notes/:id'] }),
  'instructor.notice': Object.freeze({ zone: 'instructor', routes: ['/api/notices', '/api/notices/:id'] }),
});
export const STUDENT_NOTE = 'student.note';
export const INSTRUCTOR_NOTICE = 'instructor.notice';

function segments(path) {
  return String(path).split('?')[0].split('#')[0].split('/').filter(Boolean);
}
function matches(pattern, parts) {
  const want = segments(pattern);
  return want.length === parts.length
    && want.every((piece, index) => (piece === ':id' ? parts[index].length > 0 : piece === parts[index]));
}

// 주소(경로)에서 자원 ID를 찾습니다. 어느 자원에도 맞지 않으면 null이며, 임의의 자원으로 채우지 않습니다.
export function resourceIdFor(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const parts = segments(path);
  for (const [id, resource] of Object.entries(RESOURCES)) {
    if (resource.routes.some((route) => matches(route, parts))) return id;
  }
  return null;
}
export function zoneOf(resourceId) {
  return RESOURCES[resourceId]?.zone ?? null;
}
