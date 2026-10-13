import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUCTOR_NOTICE, STUDENT_NOTE, resourceIdFor, zoneOf } from '../src/resources.mjs';

test('메모와 강사 공지는 서로 다른 자원 ID입니다', () => {
  assert.notEqual(STUDENT_NOTE, INSTRUCTOR_NOTICE);
  assert.equal(resourceIdFor('/api/notes'), STUDENT_NOTE);
  assert.equal(resourceIdFor('/api/notes/3f2b8c1e-0000-4000-8000-000000000001'), STUDENT_NOTE);
  assert.equal(resourceIdFor('/api/notices'), INSTRUCTOR_NOTICE);
  assert.equal(resourceIdFor('/api/notices/abc'), INSTRUCTOR_NOTICE);
});
test('쿼리·슬래시가 붙어도 같은 자원이고, 모르는 주소는 null입니다', () => {
  assert.equal(resourceIdFor('/api/notes?owner_id=x'), STUDENT_NOTE);
  assert.equal(resourceIdFor('/api/notes/'), STUDENT_NOTE);
  assert.equal(resourceIdFor('/api/notes/a/b'), null);
  assert.equal(resourceIdFor('/api/other'), null);
  assert.equal(resourceIdFor('api/notes'), null);
  assert.equal(resourceIdFor(undefined), null);
});
test('구역은 자원 ID로만 정해집니다', () => {
  assert.equal(zoneOf(STUDENT_NOTE), 'student');
  assert.equal(zoneOf(INSTRUCTOR_NOTICE), 'instructor');
  assert.equal(zoneOf('unknown'), null);
});
