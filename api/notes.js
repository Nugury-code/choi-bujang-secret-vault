import { createClient } from '@supabase/supabase-js';

// 서버 함수: 학습용 DB(vault_notes)에서 가상 메모를 읽어 화면에 전달합니다.
// SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽습니다.
// 키는 응답·로그·브라우저 파일에 넣지 않습니다.
// 약점: 이 주소는 공개이고 아직 로그인이 없어 누구나 호출할 수 있습니다(3단계 전까지 가상 메모만 둠).
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('notes: server settings missing');
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  try {
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await db.from('vault_notes').select('title, content').order('id');
    if (error) {
      console.error('notes: read failed', error.code ?? 'unknown');
      return response.status(502).json({ error: 'NOTES_READ_FAILED' });
    }
    return response.status(200).json({ notes: data });
  } catch {
    console.error('notes: unexpected failure');
    return response.status(500).json({ error: 'NOTES_UNEXPECTED_FAILURE' });
  }
}
