/* files.js — 사내 파일허브 업로드 (사내 표준: 파일은 파일허브, DB에는 URL만)
   인증은 Cloudflare Access 쿠키(credentials:include) — 이 앱이 constanthub.kr 서브도메인
   + Access 뒤에 배포되어 있어야 동작해요. 401/리다이렉트 시 로그인 안내 에러를 던져요.
   제한: 이미지 전용(jpg/jpeg/png/gif/webp), 최대 50MB. */

const FILE_API = 'https://data.constanthub.kr';
const TOOL = 'refilled-design-hub';

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const isUploadable = file => IMAGE_MIMES.includes(file?.type);

/** File/Blob 업로드 → 파일허브 URL 반환. 실패 시 사용자 안내 메시지를 담은 Error를 던져요. */
export async function uploadFile(file, name) {
  const fd = new FormData();
  fd.append('file', file, name || file.name);
  let r;
  try {
    r = await fetch(`${FILE_API}/api/files/upload?tool=${TOOL}`, {
      method: 'POST', body: fd, credentials: 'include',
    });
  } catch {
    throw new Error(`파일 서버에 연결하지 못했어요. 새 탭에서 ${FILE_API} 에 사내 이메일로 로그인한 뒤 다시 시도해주세요.`);
  }
  if (r.status === 401 || r.status === 403 || r.redirected) {
    throw new Error(`파일 업로드에 로그인이 필요해요. 새 탭에서 ${FILE_API} 에 사내 이메일로 로그인한 뒤 다시 시도해주세요.`);
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.response?.error || `업로드 실패 (${r.status})`);
  }
  const { response } = await r.json();
  return response.url; // 이 URL만 DB에 저장
}
