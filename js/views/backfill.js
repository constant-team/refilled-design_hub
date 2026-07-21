/* backfill.js — 일회성 데이터 백필 (#/backfill · 내비 미노출)
   왜 필요한가: Node 임포트 스크립트는 Supabase 서비스 키가 있어야 쓰기가 되는데 그 키가 없어
   매번 반영이 실패했다. 이 페이지는 "로그인된 브라우저 세션"으로 store.save()를 통해 직접 반영하므로
   서비스 키·터미널이 전혀 필요 없다. 두 백필 모두 1회용 — 반영 확인 후 이 파일/라우트는 제거 예정.

   ① 노션 요청업무 누락분  — 현재 노션에 노출된 요청/시작전/진행중/컨펌요청 업무를 허브 요청업무로.
   ② 구글시트 프로젝트 타임라인 — 7/1 이후 마일스톤을 프로젝트→하위업무→마커로.

   중복 방지: 반영 전 현재 허브 데이터를 읽어 신규/기존을 판별하고, 체크박스로 사람이 최종 확인한다.
   (노션은 notionId + 정규화 제목으로 매칭 — 허브에서 제목이 축약돼 있어도 사용자가 체크로 조정 가능) */
import { store, todayISO } from '../store.js';
import { esc, toast } from '../ui.js';
import { applySheet } from './timeline.js';

/* ── ① 노션 요청업무 (2026-07-22 조회 기준, 안내/요청서 템플릿 제외) ──
   assignees = 디자인 담당자 이메일(=허브 멤버 id). requester = 기획자(없으면 요청자) 이름. */
const NOTION_TASKS = [
  { nid: '384bd60b-5762-80dd-abbd-c18ac779709b', title: '부스터 미니 용기 & 단상자', status: 'confirm', due: '2026-07-24', priority: '중간', link: '', assignees: [], requester: '이근아' },
  { nid: '390bd60b-5762-8018-ab42-c22acd972aec', title: '택배박스/테이프 디자인', status: 'doing', due: '2026-07-24', priority: '중간', link: '', assignees: ['yeonwoo@theconst.kr'], requester: '이근아' },
  { nid: '39ebd60b-5762-80e5-99ff-f7e6cb1c220e', title: '부스터프로 100ml 용기 디자인 발주파일', status: 'doing', due: '2026-07-23', priority: '중간', link: '', assignees: ['geunalee@theconst.kr'], requester: '김수희' },
  { nid: '39cbd60b-5762-807b-b336-ec7452ff2619', title: '이마트 트레이더스 RRP 패키지 제작 요청', status: 'doing', due: '2026-07-24', priority: '중간', link: '', assignees: ['yeonwoo@theconst.kr', 'minhyeon@theconst.kr', 'geunalee@theconst.kr'], requester: '강다현' },
  { nid: '39dbd60b-5762-80ef-adc3-fb06d5bb8601', title: '쿠팡 클렌저 용기 디자인 요청', status: 'confirm', due: '2026-07-20', priority: '높음', link: 'https://figma.com/board/w4YhUPSZQZyKq61WAzHgg9/-제품팀--단상자-패키지-기획안?node-id=8542-6421', assignees: ['geunalee@theconst.kr'], requester: '강다현' },
  { nid: '39cbd60b-5762-8007-96cb-e8d75f636945', title: '[올리브영] 산리오 2종 상세페이지 제작 요청', status: 'doing', due: '2026-07-30', priority: '중간', link: '', assignees: ['yeonwoo@theconst.kr', 'minhyeon@theconst.kr'], requester: '양지현' },
  { nid: '39ebd60b-5762-80d4-bad6-f522d093d26f', title: '[올리브영] 상시 썸네일 제작 요청 (헤어케어4종)', status: 'confirm', due: '2026-07-21', priority: '중간', link: '', assignees: ['geunalee@theconst.kr'], requester: '양지현' },
  { nid: '3a3bd60b-5762-80f1-aa80-c8732e2c5b28', title: '[큐텐 프로모션]8월 메가포 샵배너+섬네일 제작 요청', status: 'req', due: '2026-07-28', priority: '높음', link: 'https://www.figma.com/board/duBITgW6vvpkDEGSLcJAJD/큐텐-프로모션-배너?node-id=672-990', assignees: [], requester: '송승한' },
  { nid: '3a3bd60b-5762-80d9-8ce9-e04c1a9fe752', title: '[틱톡샵US] 썸네일 변경 요청', status: 'doing', due: '2026-07-23', priority: '중간', link: 'https://www.figma.com/board/CR8IGSJE6dHoHWynpo9wix/2607_TTS-썸네일?node-id=0-1', assignees: ['geunalee@theconst.kr'], requester: '김민준' },
  { nid: '3a3bd60b-5762-803c-be8b-f10d7b277544', title: '[일본] 상세페이지 공통 상단 배너', status: 'req', due: '2026-07-27', priority: '중간', link: 'https://www.figma.com/design/XDZ0hjDNYQTtZoiVcLwy7K/큐텐-소재?node-id=572-92', assignees: ['geunalee@theconst.kr'], requester: '차준후' },
  { nid: '39ebd60b-5762-800d-86b8-f7fd7da7e4a1', title: '[북미 아마존] 썸네일 및 상세페이지 디자인 요청', status: 'doing', due: '2026-07-31', priority: '중간', link: '', assignees: ['minhyeon@theconst.kr'], requester: '방민현' },
  { nid: '390bd60b-5762-80d0-aeb1-d773c61e9812', title: '브로슈어 디자인', status: 'confirm', due: '2026-07-13', priority: '중간', link: '', assignees: ['geunalee@theconst.kr', 'yeonwoo@theconst.kr'], requester: '김수희 외 1' },
  { nid: '39ebd60b-5762-8025-897d-d6fbeb84375b', title: '[일본시딩용] 루미키트 부자재 디자인 요청', status: 'req', due: '2026-07-24', priority: '중간', link: '', assignees: ['minhyeon@theconst.kr'], requester: '김수희 외 3' },
  { nid: '39fbd60b-5762-80eb-a196-cd36c9009687', title: '부스터 100ml 단상자 디자인요청', status: 'doing', due: '2026-07-24', priority: '🚨긴급', link: 'https://www.figma.com/board/w4YhUPSZQZyKq61WAzHgg9/-제품팀--단상자-패키지-기획안?node-id=8800-6689', assignees: ['geunalee@theconst.kr'], requester: '김수희' },
  { nid: '39fbd60b-5762-807c-9c19-e0b5314ac7a7', title: '[브랜디드] 범용 브랜드 소개서', status: 'req', due: '2026-07-31', priority: '중간', link: 'https://www.figma.com/deck/vXLZk1EAWrrFXp3Kt8PLga', assignees: ['yeonwoo@theconst.kr'], requester: '정라영' },
  { nid: '3a3bd60b-5762-8038-b1cf-df6890c6a90d', title: '[트래픽캠페인 포맷] 디자인 포맷 요청', status: 'req', due: '2026-07-31', priority: '중간', link: '', assignees: ['geunalee@theconst.kr', 'yeonwoo@theconst.kr'], requester: '정라영' },
  { nid: '390bd60b-5762-8021-a7f6-d30960ce052f', title: '두피스캐너 디자인', status: 'doing', due: '', priority: '높음', link: '', assignees: ['geunalee@theconst.kr', 'yeonwoo@theconst.kr', 'minhyeon@theconst.kr'], requester: '이재훈' },
  { nid: '3a3bd60b-5762-8032-8876-de1f67ef9532', title: '[시코르 집기 제작] 점포별 시안 제작 및 집기 발주 요청', status: 'req', due: '2026-07-29', priority: '높음', link: 'https://www.figma.com/board/NFlhhhc65CKrUq0qV0BHUF/시코르-집기?node-id=30-46', assignees: ['geunalee@theconst.kr'], requester: '이경윤' },
  { nid: '3a4bd60b-5762-80a4-b06a-f58b7cde8bac', title: '[일본] 리뷰 이벤트 배너', status: 'req', due: '2026-07-28', priority: '중간', link: 'https://www.figma.com/design/XDZ0hjDNYQTtZoiVcLwy7K/큐텐-소재?node-id=377-206', assignees: [], requester: '차준후' },
  { nid: '3a4bd60b-5762-8032-b1cd-cd27959f842a', title: '[큐텐] 1위 엠블럼 제작', status: 'req', due: '2026-07-28', priority: '중간', link: 'https://www.figma.com/design/XDZ0hjDNYQTtZoiVcLwy7K/큐텐-소재?node-id=377-206', assignees: ['minhyeon@theconst.kr'], requester: '차준후' },
  { nid: '3a4bd60b-5762-8067-890a-e7f34cae20d6', title: '[네이버&쿠팡 썸네일] 리브랜딩 썸네일 작업 요청', status: 'req', due: '2026-07-27', priority: '중간', link: 'https://www.figma.com/board/NPhX6t64eRwYbEei4Uv5di/-MD팀--썸네일?node-id=309-215', assignees: [], requester: '이경윤' },
];

/* ── ② 구글시트 프로젝트 타임라인 (7/1 이후, 파싱 결과) ── */
const CSV_PROJECTS = [
  { name: '[리브랜딩] 자사몰', subs: [
    { task: '쇼핑백 리뉴얼', owner: '연우', prog: '진행', ms: [{ date: '2026-07-17', text: '일정' }, { date: '2026-07-24', text: '최종시안' }] },
    { task: '택배박스/테이프 리뉴얼', owner: '', prog: '진행', ms: [{ date: '2026-07-07', text: '1차시안' }, { date: '2026-07-13', text: '2차시안' }, { date: '2026-07-17', text: '일정' }, { date: '2026-07-24', text: '최종시안' }] },
    { task: '리브랜딩 브로셔', owner: '', prog: '진행', ms: [{ date: '2026-07-02', text: '일정' }, { date: '2026-07-07', text: '1차시안' }, { date: '2026-07-10', text: '2차시안' }, { date: '2026-07-13', text: '최종시안' }] },
    { task: '괄사(단순로고교체)', owner: '근아', prog: '진행', ms: [{ date: '2026-07-10', text: '최종시안' }] },
    { task: '핸드미러(단순로고교체)', owner: '', prog: '대기', ms: [{ date: '2026-07-24', text: '최종시안' }] },
  ] },
  { name: '[리브랜딩] 부스터 프로 +리필+미니', subs: [
    { task: '미니 용기', owner: '', prog: '진행', ms: [{ date: '2026-07-24', text: '발주' }] },
    { task: '미니 단상자', owner: '', prog: '진행', ms: [{ date: '2026-07-24', text: '발주' }] },
    { task: '상세페이지', owner: '', prog: '완료', ms: [{ date: '2026-07-03', text: '최종시안' }] },
  ] },
  { name: '[리브랜딩] 이펙터', subs: [
    { task: '용기', owner: '', prog: '대기', ms: [{ date: '2026-07-01', text: '기획전달' }, { date: '2026-07-08', text: '1차시안' }, { date: '2026-07-24', text: '발주' }] },
    { task: '단상자', owner: '', prog: '대기', ms: [{ date: '2026-07-01', text: '기획전달' }, { date: '2026-07-08', text: '1차시안' }, { date: '2026-07-24', text: '발주' }] },
  ] },
  { name: '[리브랜딩] 트리트먼트', subs: [
    { task: '상세페이지', owner: '', prog: '대기', ms: [{ date: '2026-07-10', text: '기획전달' }, { date: '2026-07-13', text: '1차시안' }, { date: '2026-07-24', text: '2차시안' }, { date: '2026-07-31', text: '최종시안' }] },
  ] },
  { name: '[리브랜딩] 아이래쉬', subs: [
    { task: '상세페이지', owner: '', prog: '진행', ms: [{ date: '2026-07-10', text: '최종시안' }] },
  ] },
  { name: '[신규] 클렌저', subs: [
    { task: '상세페이지', owner: '근아', prog: '완료', ms: [{ date: '2026-07-01', text: '일정' }] },
  ] },
  { name: '[신규] 부스터 쿨링', subs: [
    { task: '썸네일', owner: '', prog: '진행', ms: [{ date: '2026-07-03', text: '일정' }] },
    { task: '상세페이지', owner: '', prog: '진행', ms: [{ date: '2026-07-03', text: '일정' }] },
  ] },
  { name: '[OY_기획세트] 산리오 2종', subs: [
    { task: '누끼컷', owner: '근아', prog: '완료', ms: [{ date: '2026-07-10', text: '기획전달' }, { date: '2026-07-30', text: '최종시안' }] },
    { task: '썸네일', owner: '연우', prog: '진행', ms: [{ date: '2026-07-10', text: '기획전달' }, { date: '2026-07-30', text: '최종시안' }] },
    { task: '상세페이지', owner: '', prog: '진행', ms: [{ date: '2026-07-10', text: '기획전달' }, { date: '2026-07-30', text: '최종시안' }] },
  ] },
  { name: '[OY_기획세트] 아이래쉬 V3 (7월 말)', subs: [
    { task: '단상자', owner: '연우', prog: '대기', ms: [{ date: '2026-07-06', text: '2차시안' }, { date: '2026-07-20', text: '최종시안' }] },
  ] },
  { name: '[OY_기획세트] 부스터 리브랜딩 온고잉 (8월 말)', subs: [
    { task: '단상자', owner: '근아', prog: '진행', ms: [{ date: '2026-07-13', text: '2차시안' }, { date: '2026-07-17', text: '최종시안' }] },
  ] },
];

const STATUS_LABEL = { req: '요청', doing: '진행 중', confirm: '컨펌요청', done: '완료' };
/* 제목 정규화: 대괄호/괄호/공백 제거 + 흔한 접미 키워드 제거 → 허브 축약본과 느슨하게 매칭 */
const normTitle = s => String(s || '').replace(/\[[^\]]*\]|\([^)]*\)|[()（）\s]/g, '').replace(/요청|제작|디자인|작업|변경|파일/g, '').toLowerCase();

function notionCandidates() {
  const tasks = store.db.tasks || [];
  const byNid = new Set(tasks.map(t => t.notionId).filter(Boolean));
  const byNormTitle = new Map(tasks.map(t => [normTitle(t.title), t.title]));
  return NOTION_TASKS.map(n => {
    const idMatch = byNid.has(n.nid);
    const titleHit = byNormTitle.get(normTitle(n.title));
    const exists = idMatch || !!titleHit;
    return { ...n, exists, matchedTitle: idMatch ? '(같은 노션 항목)' : (titleHit || '') };
  });
}
function csvCandidates() {
  const names = new Set((store.db.projects || []).map(p => p.name));
  return CSV_PROJECTS.map(p => ({ ...p, exists: names.has(p.name), subCnt: p.subs.length, msCnt: p.subs.reduce((k, s) => k + s.ms.length, 0) }));
}

function addNotion(list) {
  const today = todayISO();
  list.forEach(n => {
    const id = 'nt_' + n.nid.replace(/-/g, '');
    if (store.db.tasks.some(t => t.id === id)) return;
    store.db.tasks.push({
      id, notionId: n.nid, kind: 'request', title: n.title, project: '',
      assignees: n.assignees || [],   // 멤버 id = 이메일 (디렉토리). 없는 이메일은 화면에 '미지정'으로 표시될 뿐 무해
      _designerNames: [], status: n.status, priority: n.priority || '중간',
      requester: n.requester || '노션 요청', requestedAt: n.due || today, due: n.due || '',
      link: n.link || '', files: [], notes: n.link ? '기획안: ' + n.link : '',
      createdAt: new Date().toISOString(), importedFrom: 'notion',
    });
  });
  store.save();
}

export function renderBackfill(main) {
  const nCands = notionCandidates();
  const cCands = csvCandidates();
  const nNew = nCands.filter(c => !c.exists).length;
  const cNew = cCands.filter(c => !c.exists).length;

  const nRows = nCands.map((c, i) => `
    <label style="display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;${c.exists ? 'opacity:.6' : ''}">
      <input type="checkbox" data-n="${i}" ${c.exists ? '' : 'checked'} style="margin-top:3px">
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${esc(c.title)}
          <span style="background:#eef1f5;border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:600;margin-left:4px">${STATUS_LABEL[c.status]}</span>
          ${c.exists ? '<span style="color:#9AA1AC;font-size:11px;margin-left:4px">이미 있음 → 건너뜀</span>' : '<span style="color:#059669;font-size:11px;margin-left:4px">신규</span>'}</div>
        <div style="font-size:11.5px;color:#667">담당 ${c.assignees.length ? esc(c.assignees.map(e => (store.member(e)?.name || e)).join(', ')) : '미지정'} · 요청 ${esc(c.requester)}${c.due ? ' · 마감 ' + c.due.slice(5) : ''}${c.exists && c.matchedTitle ? ` · 매칭: ${esc(c.matchedTitle)}` : ''}</div>
      </div>
    </label>`).join('');

  const cRows = cCands.map((c, i) => `
    <label style="display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;${c.exists ? 'opacity:.6' : ''}">
      <input type="checkbox" data-c="${i}" ${c.exists ? '' : 'checked'} style="margin-top:3px">
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${esc(c.name)} ${c.exists ? '<span style="color:#9AA1AC;font-size:11px">이미 있음</span>' : '<span style="color:#059669;font-size:11px">신규</span>'}</div>
        <div style="font-size:11.5px;color:#667">하위 업무 ${c.subCnt} · 마일스톤 ${c.msCnt}</div>
      </div>
    </label>`).join('');

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">1회용 백필 · 반영 후 이 페이지는 제거됩니다</span>
    <h1>데이터 가져오기</h1><p>지금 로그인된 세션으로 바로 반영돼요(서비스 키·터미널 불필요). 아래에서 <b>신규만 체크</b>돼 있어요 — 확인 후 반영을 눌러주세요.</p></div>

  <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>① 노션 요청업무 <span class="sub">신규 ${nNew} / 전체 ${nCands.length}</span></h3></div>
    <div class="card-b">
      <div style="margin-bottom:10px">${nRows}</div>
      <button class="btn primary" id="bf-notion">체크한 요청업무 반영</button>
      <span id="bf-notion-res" style="margin-left:10px;font-size:12.5px;color:#059669"></span>
    </div></div>

  <div class="card"><div class="card-h"><h3>② 프로젝트 타임라인(구글시트) <span class="sub">신규 ${cNew} / 전체 ${cCands.length}</span></h3></div>
    <div class="card-b">
      <div style="margin-bottom:10px">${cRows}</div>
      <button class="btn primary" id="bf-csv">체크한 프로젝트 반영</button>
      <span id="bf-csv-res" style="margin-left:10px;font-size:12.5px;color:#059669"></span>
    </div></div>`;

  main.querySelector('#bf-notion').onclick = () => {
    const pick = [...main.querySelectorAll('[data-n]:checked')].map(el => nCands[+el.dataset.n]);
    if (!pick.length) return toast('체크한 업무가 없어요', true);
    addNotion(pick);
    main.querySelector('#bf-notion-res').textContent = `${pick.length}건 반영 — 저장 중… 요청업무 보드에서 확인하세요`;
    toast(`요청업무 ${pick.length}건 반영했어요`);
    setTimeout(() => renderBackfill(main), 1200);
  };
  main.querySelector('#bf-csv').onclick = () => {
    const pick = [...main.querySelectorAll('[data-c]:checked')].map(el => cCands[+el.dataset.c]);
    if (!pick.length) return toast('체크한 프로젝트가 없어요', true);
    const r = applySheet(pick);
    main.querySelector('#bf-csv-res').textContent = `프로젝트 +${r.pAdd}·갱신 ${r.pUpd}, 하위 업무 ${r.tCnt}건 — 저장 중…`;
    toast('프로젝트 타임라인을 반영했어요');
    setTimeout(() => renderBackfill(main), 1200);
  };
}
