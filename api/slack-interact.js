/* api/slack-interact.js — 슬랙 버튼 클릭 신호 수신기
 * 링크 버튼은 별도 처리가 필요 없으므로 "잘 받았어요"(200)만 응답해요.
 * 이 주소를 슬랙 앱의 Interactivity Request URL로 등록하면
 * 버튼 옆 ⚠️ 경고 아이콘이 사라져요. */
export default async function handler(req, res) {
  return res.status(200).send('');
}
