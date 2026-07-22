#!/usr/bin/env node
/* tools/migrate-relational.mjs — 옛 jsonb 테이블 → 관계형 *_v2 테이블 이관
 *
 * schema-v2.sql 로 *_v2 테이블을 먼저 만든 뒤 실행하세요.
 * 옛 Supabase 테이블(tasks/projects/archive/rituals/members)에서 직접 읽어
 * 컬럼으로 파싱하고, 멤버 참조(uid→email)를 정규화해 *_v2 로 upsert 합니다.
 *
 * 사용법:
 *   1) cp .env.migrate.example .env.migrate  →  SUPABASE_URL / SUPABASE_SERVICE_KEY 채우기
 *   2) node tools/migrate-relational.mjs        →  드라이런 (읽기·매핑만, 쓰기 없음)
 *   3) node tools/migrate-relational.mjs --run  →  실제 이관
 *
 * 멱등(upsert) — 재실행 안전. ⚠️ 스테이징에서 먼저 검증하세요(계획: Phase 5).
 * 의존성 없음 (Node 18+ 내장 fetch + PostgREST REST).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = process.argv.includes('--run');
const PAGE = 1000; // PostgREST 페이지 크기 (절단 방지: 페이지 단위로 끝까지)

/* ── .env.migrate 로드 (없으면 환경변수 사용) ── */
try {
  for (const line of readFileSync(resolve(ROOT, '.env.migrate'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 파일 없으면 셸 환경변수로 */ }

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요해요 (.env.migrate 참고)');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/* 옛 테이블 전 행을 data jsonb 로 읽기 — Range 페이징으로 db-max-rows 절단 방지 */
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=data&order=id`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!r.ok) throw new Error(`${table} 읽기 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    out.push(...rows.map(x => x.data).filter(Boolean));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += PAGE) {
    const chunk = rows.slice(i, i + PAGE);
    const r = await fetch(`${URL_}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`${table} upsert 실패 ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}

/* ── 매핑 헬퍼 ── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = v => (typeof v === 'string' && DATE_RE.test(v)) ? v : null;
const omit = (obj, keys) => { const o = { ...obj }; for (const k of keys) delete o[k]; return o; };

console.log(RUN ? '🚀 실제 이관 모드' : '🔍 드라이런 (쓰기 없음) — 실제 이관은 --run\n');

/* ── 옛 테이블 읽기 ── */
const [oldProjects, oldTasks, oldArchive, oldRituals, oldMembers] = await Promise.all(
  ['projects', 'tasks', 'archive', 'rituals', 'members'].map(fetchAll)
);

/* 멤버 id→email 맵 (옛 members 테이블의 마지막 사용) — uid 참조를 이메일로 정규화 */
const memberEmail = {};
for (const m of oldMembers) if (m?.id && m?.email) memberEmail[String(m.id)] = m.email;
const resolveEmail = id => {
  if (!id) return null;
  const s = String(id);
  if (s.includes('@')) return s;          // 이미 이메일
  return memberEmail[s] || s;             // uid→email, 미지정 uid는 그대로(표시 시 '미지정')
};
const isEmail = s => typeof s === 'string' && s.includes('@');

/* ── projects_v2 ── */
const projRows = oldProjects.filter(p => p?.id).map(p => ({
  id: String(p.id),
  name: p.name ?? null,
  color: p.color ?? null,
  start: asDate(p.start),
  end: asDate(p.end),
  owner_id: resolveEmail(p.owner),
  archived: !!p.archived,
  extra: omit(p, ['id', 'name', 'color', 'start', 'end', 'owner', 'archived']),
}));
const projectIds = new Set(projRows.map(p => p.id));

/* ── tasks_v2 ── */
let orphanProj = 0;
const taskRows = oldTasks.filter(t => t?.id).map(t => {
  const assignees = (Array.isArray(t.assignees) ? t.assignees
    : (t.assignee ? [t.assignee] : [])).map(resolveEmail).filter(Boolean);
  let project_id = t.project ? String(t.project) : null;
  if (project_id && !projectIds.has(project_id)) { project_id = null; orphanProj++; } // 고아 → FK 대비 null
  const extra = omit(t, ['id', 'project', 'kind', 'status', 'tlStatus', 'priority',
    'requester', 'title', 'due', 'doneAt', 'createdAt', 'link', 'notes', 'mt', 'assignee', 'assignees']);
  extra.assignees = assignees; // 정규화된 이메일 배열
  return {
    id: String(t.id),
    project_id,
    kind: t.kind ?? null,
    status: t.status ?? null,
    tl_status: t.tlStatus ?? null,
    priority: t.priority ?? null,
    requester: t.requester ?? null,
    title: t.title ?? null,
    due: asDate(t.due),
    done_at: asDate(t.doneAt),
    created_at: t.createdAt ?? null,
    link: t.link ?? null,
    notes: t.notes ?? null,
    extra,
    mt: t.mt ?? null,
  };
});

/* ── archive_v2 ── */
const archRows = oldArchive.filter(a => a?.id).map(a => ({
  id: String(a.id),
  kind: a.kind || 'asset',
  title: a.title ?? null,
  url: a.url ?? null,
  owner_id: resolveEmail(a.owner),
  project: a.project ?? null, // 자유 텍스트 유지
  version: a.version ?? null,
  date: asDate(a.date),
  notes: a.notes ?? null,
  author: a.author ?? null,
  extra: omit(a, ['id', 'kind', 'title', 'url', 'owner', 'project', 'version', 'date', 'notes', 'author']),
}));

/* ── rituals_v2 (문서형 — 본문 전체를 extra 유지, 스코프 컬럼만 추출) ── */
const ritRows = oldRituals.filter(r => r?.id).map(r => ({
  id: String(r.id),
  type: r.type ?? null,
  date: asDate(r.date),
  quarter: r.quarter ?? null,
  extra: r,
}));

/* ── 리포트 ── */
const nonEmailRefs = [
  ...projRows.map(p => p.owner_id),
  ...taskRows.flatMap(t => t.extra.assignees),
  ...archRows.map(a => a.owner_id),
].filter(x => x && !isEmail(x));

console.log('  projects_v2', String(projRows.length).padStart(4));
console.log('  tasks_v2   ', String(taskRows.length).padStart(4), `(고아 project→null ${orphanProj}건)`);
console.log('  archive_v2 ', String(archRows.length).padStart(4));
console.log('  rituals_v2 ', String(ritRows.length).padStart(4));
console.log(`  합계 ${projRows.length + taskRows.length + archRows.length + ritRows.length}건`);
if (nonEmailRefs.length) {
  console.log(`  ⚠️ 이메일로 해석 못 한 멤버 참조 ${nonEmailRefs.length}건 (표시 시 '미지정'): ${[...new Set(nonEmailRefs)].slice(0, 10).join(', ')}`);
}
console.log('');

if (!RUN) { console.log('드라이런 종료 — 문제 없으면 --run 으로 실행하세요.'); process.exit(0); }

/* ── 실행: 부모(projects) → 자식(tasks/archive/rituals) 순서 (FK 위반 방지) ── */
await upsert('projects_v2', projRows);
await upsert('tasks_v2', taskRows);
await upsert('archive_v2', archRows);
await upsert('rituals_v2', ritRows);
console.log('✅ 이관 완료. count 대조로 검증하세요.');
