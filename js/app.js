/* app.js — 라우터 & 부트스트랩 */
import { store } from './store.js';
import { supaState, LOGIN_URL } from './supabase.js';
import { $, $$, toast } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTasks } from './views/tasks.js';
import { renderRituals } from './views/rituals.js';
import { renderArchive } from './views/archive.js';
import { renderStudio } from './views/studio.js';
import { renderSettings } from './views/settings.js';

const routes = {
  dashboard: renderDashboard,
  tasks: renderTasks,
  rituals: renderRituals,
  archive: renderArchive,
  studio: renderStudio,
  settings: renderSettings,
};

function route() {
  const parts = (location.hash || '#/dashboard').replace('#/', '').split('?')[0].split('/');
  const key = parts[0];
  const render = routes[key] || renderDashboard;
  $$('#nav a, .settings-link').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  render($('#main'), parts.slice(1).join('/'));
}

function syncBadge() {
  const b = $('#sync-badge');
  const map = {
    local: ['로컬 모드', ''],
    syncing: ['동기화 중…', 'on'],
    synced: ['팀 동기화 ✓', 'on'],
    error: ['동기화 오류', 'err'],
  };
  const [label, cls] = map[store.status] || map.local;
  b.textContent = label;
  b.className = 'sync-badge ' + cls;
  b.title = store.status === 'error'
    ? `오류: ${store.lastError || '알 수 없음'} — 클릭하면 다시 동기화해요`
    : store.hasRemote() ? '클릭하면 최신 데이터를 다시 불러와요'
    : store.serverDetail ? `자동 동기화 안 되는 이유: ${store.serverDetail}`
    : '팀 동기화 연결을 확인하는 중이에요';
  b.style.cursor = 'pointer';
  b.onclick = async () => {
    if (!store.hasRemote()) {
      const ok = await store.pull(); // pull()이 내부에서 재연결(브릿지 세션)까지 시도해요
      if (ok) { toast('동기화가 연결됐어요 — 최신 데이터예요'); window.dispatchEvent(new Event('hashchange')); return; }
      if (supaState.mode === 'need-login') {
        // 사내 로그인이 필요 → 로그인 탭을 열어주고, 로그인 후 배지를 다시 누르면 연결돼요
        window.open(LOGIN_URL, '_blank', 'noopener');
        toast('새 탭에서 사내 이메일로 로그인한 뒤, 이 배지를 다시 클릭해주세요');
        return;
      }
      toast(store.serverDetail ? `자동 동기화 안 되는 이유: ${store.serverDetail}` : '팀 동기화 연결을 확인하는 중…', !!store.serverDetail);
      return;
    }
    toast('다시 동기화하는 중…');
    await store.push();               // 대기 중인 변경 먼저 반영
    if (store.status === 'error') {
      toast(`동기화 오류: ${store.lastError || '알 수 없는 문제'}`, true);
    } else {
      await store.pull();
      toast('동기화 완료 — 최신 데이터예요');
    }
    window.dispatchEvent(new Event('hashchange'));
  };
}

store.onChange(syncBadge);
window.addEventListener('hashchange', route);

/* 로그인 사용자 표시 (Cloudflare Access 신원 — CF가 도메인에 제공하는 엔드포인트) */
async function authBox() {
  const box = $('#auth-box');
  if (!box) return;
  try {
    const r = await fetch('/cdn-cgi/access/get-identity');
    if (!r.ok) return; // CF Access 밖(로컬 테스트 등) → 표시 안 함
    const u = await r.json();
    const name = u.name || (u.email || '').split('@')[0];
    if (!name) return;
    if (!store.settings.userName) { store.settings.userName = name; store.saveSettings(); } // 새 브라우저: 작성자명 자동 채움
    box.hidden = false;
    box.innerHTML = `<span class="au-name" title="${u.email || ''}">👤 ${name}</span>`;
  } catch {}
}

// 정식 접속 주소 — 팀 데이터(Supabase 브릿지·디렉토리·파일허브)는 *.constanthub.kr 에서만 동작(CORS).
const CANONICAL_HOST = 'refilled-design.constanthub.kr';
/* 비정식 호스트(옛 vercel.app 주소 등)로 들어오면 동기화가 불가하고 혼란을 주므로, 부팅 전에 정식 주소로 보냄.
   ⚠️ 이 코드가 실린 배포에만 적용됨 — 버려진 옛 배포에는 적용 안 됨(그건 Vercel에서 프로젝트 삭제로 처리). */
function wrongHostGuard() {
  const h = location.hostname;
  if (h.endsWith('.constanthub.kr') || h === 'localhost' || h === '127.0.0.1') return false;
  const target = 'https://' + CANONICAL_HOST + location.pathname + (location.hash || '');
  document.body.innerHTML = `<div style="max-width:520px;margin:12vh auto;padding:28px;text-align:center;font-family:system-ui,sans-serif">
    <div style="font-size:40px">🚚</div>
    <h2 style="margin:12px 0 8px">여긴 옛 주소예요</h2>
    <p style="color:#666;line-height:1.6">이 주소(<b>${location.hostname}</b>)에서는 팀 데이터가 동기화되지 않아요.<br>정식 주소로 이동합니다 — <b>북마크도 아래 주소로</b> 바꿔주세요.</p>
    <p style="margin:16px 0"><a href="${target}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">정식 주소로 이동 →</a></p>
    <p style="color:#999;font-size:12px">${CANONICAL_HOST}</p></div>`;
  setTimeout(() => location.replace(target), 1500);
  return true;
}

/* ── 새 배포 감지 → 최신 JS로 자동 새로고침 ──
   열어둔 탭은 한 번 로드한 JS 모듈을 새로고침 전까지 메모리에 계속 써서 '옛 동작'이 남아요.
   배포된 index.html의 버전(.app-ver)을 주기적으로 대조해, 다르면 안전할 때 자동 새로고침하고
   편집 중(모달·입력 포커스)이면 방해하지 않고 배너로 안내해요. */
const LOADED_VER = (document.querySelector('.app-ver')?.textContent || '').trim();
let _updatePending = false;
function safeToReload() {
  const modalOpen = !document.getElementById('modal-root')?.hidden;
  const el = document.activeElement;
  const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '');
  return !modalOpen && !typing;
}
function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner';
  b.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;background:#111;color:#fff;padding:11px 16px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.28);display:flex;align-items:center;gap:12px;font-size:13px;font-weight:600';
  b.innerHTML = `🔄 새 버전이 배포됐어요 <button id="ub-reload" style="background:#2563EB;color:#fff;border:none;border-radius:8px;padding:6px 13px;font-weight:700;cursor:pointer">새로고침</button>`;
  document.body.appendChild(b);
  b.querySelector('#ub-reload').onclick = () => location.reload();
}
async function checkVersion() {
  if (!LOADED_VER) return;
  try {
    const r = await fetch('/index.html', { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.text()).match(/class="app-ver"[^>]*>([^<]+)</);
    const latest = m && m[1].trim();
    if (latest && latest !== LOADED_VER) {
      _updatePending = true;
      if (safeToReload()) location.reload(); else showUpdateBanner();
    }
  } catch { /* 네트워크 실패는 조용히 무시 */ }
}
function versionWatch() {
  setTimeout(checkVersion, 4000);            // 부팅 직후 1회
  setInterval(checkVersion, 5 * 60 * 1000);  // 5분마다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_updatePending && safeToReload()) location.reload(); // 잠깐 떠난 탭 복귀 시 자동 최신화
    else checkVersion();
  });
}

(async function boot() {
  if (wrongHostGuard()) return; // 비정식 주소면 여기서 중단(동기화 오류 노출 방지)
  authBox();
  syncBadge();
  versionWatch();
  route(); // localStorage 캐시로 즉시 표시
  // Supabase 연결(브릿지 세션) 후 팀 데이터로 교체.
  // 재배포 직후 콜드스타트·세션 워밍업으로 첫 pull이 실패하면 오래된 캐시가 그대로 남으므로,
  // 짧은 백오프로 몇 번 더 시도해 자동으로 최신본을 받아와요 (수동 '다시 불러오기' 불필요).
  let ok = false;
  for (let i = 0; i < 4; i++) {
    ok = await store.pull();
    if (ok) break;
    if (i < 3) await new Promise(r => setTimeout(r, 700 * (i + 1)));
  }
  if (ok) route();   // 팀 최신 데이터 반영
})();
