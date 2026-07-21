/* api/ai.js — LLM 호출 서버 프록시 (키는 서버 env에만, 브라우저에 노출 안 됨)
 *
 * 브라우저(js/ai.js)가 {system, prompt, images, tools, maxTokens}를 POST하면
 * 서버가 회사 키로 Gemini(무료 우선) 또는 Claude를 호출하고 텍스트만 돌려줘요.
 *
 * 보안: /api/*는 미들웨어 게이트에서 제외되므로 vercel.app 직접 접근이 가능해요.
 *   → 이 함수가 직접 CF Access 서명을 검증(fail-closed): 프로덕션·프리뷰에서는
 *     검증 통과한 사내 구성원만 호출 가능. 로컬(vercel dev)만 예외로 허용.
 *
 * 필요한 환경변수:
 *  GEMINI_API_KEY    — Google AI Studio 키 (무료 등급)
 *  ANTHROPIC_API_KEY — Anthropic 키
 *  CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD — 호출자 인증 (middleware.js와 동일)
 */
import { verifyCfAccess } from './_lib/cf-access.js';

const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-2.5-flash'];

function friendlyGeminiErr(status, raw) {
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(raw)) {
    return { message: 'Gemini 무료 사용량 한도를 초과했어요. 잠시 뒤 다시 시도하거나 내일 한도 초기화 후 사용해주세요.', quota: true };
  }
  if (/API key not valid|API_KEY_INVALID/i.test(raw))
    return { message: 'Gemini API 키(서버 설정)가 올바르지 않아요. 테크팀에 문의해주세요.' };
  return { message: raw || 'Gemini API 오류 ' + status };
}

async function callGemini({ system, prompt, images, tools, maxTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null; // 키 없으면 Claude로 폴백하도록 null
  const parts = [];
  (images || []).forEach(im => parts.push({ inline_data: { mime_type: im.mime, data: im.data } }));
  parts.push({ text: prompt });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: Math.max(maxTokens || 1500, 2048) } };
  if (system) body.system_instruction = { parts: [{ text: system }] };
  if (tools) body.tools = [{ google_search: {} }]; // 웹 검색 요청 → Gemini 그라운딩

  let lastStatus = 0, lastErr = '';
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[i]}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json();
      const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
      if (!out) throw { status: 502, ...friendlyGeminiErr(0, 'Gemini 응답이 비어 있어요' + (data.candidates?.[0]?.finishReason ? ` (${data.candidates[0].finishReason})` : '')) };
      return out;
    }
    const err = await res.json().catch(() => ({}));
    lastStatus = res.status; lastErr = err?.error?.message || ('Gemini API 오류 ' + res.status);
    const fallbackable = res.status === 404 || res.status === 429
      || /no longer available|not found|not supported|quota|RESOURCE_EXHAUSTED/i.test(lastErr);
    if (!fallbackable) throw { status: 502, ...friendlyGeminiErr(res.status, lastErr) };
  }
  throw { status: 502, ...friendlyGeminiErr(lastStatus, lastErr) };
}

async function callClaude({ system, prompt, images, tools, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw { status: 503, message: 'AI 키(서버 설정)가 없어요. 테크팀에 문의해주세요.' };
  const content = [];
  (images || []).forEach(im => content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } }));
  content.push({ type: 'text', text: prompt });
  const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens || 1500, messages: [{ role: 'user', content }] };
  if (system) body.system = system;
  if (Array.isArray(tools)) body.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { status: 502, message: err?.error?.message || 'Claude API 오류 ' + res.status };
  }
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 인증: CF Access 검증 (fail-closed). 로컬 vercel dev(development)만 예외.
  const cf = await verifyCfAccess(req);
  const isLocal = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'development';
  if (!cf.ok && !isLocal) return res.status(401).json({ error: '사내 로그인이 필요해요.' });

  const { system, prompt, images, tools, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt가 필요해요.' });

  try {
    // Gemini(무료) 우선, 키 없으면 Claude
    let text = await callGemini({ system, prompt, images, tools, maxTokens });
    if (text == null) text = await callClaude({ system, prompt, images, tools, maxTokens });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e), quota: !!e?.quota });
  }
}
