/* rowmap.js — 관계형 *_v2 행 ↔ 뷰 객체 매핑 (Expand-Contract)
 *
 * DB(*_v2)는 real 컬럼 + extra jsonb. 뷰 코드는 기존 평면 객체(t.project / t.tlStatus /
 * t.assignees / p.owner …)를 그대로 사용하므로:
 *   FROM[table](row)  : 컬럼 + extra 를 합쳐 옛 평면 객체로 복원 (읽기)
 *   TO[table](obj)    : 평면 객체를 컬럼 / extra 로 분해 (쓰기)
 *
 * 순수 함수 — 외부 의존 없음(단독 단위테스트 가능). round-trip: FROM(TO(x)) ≈ x.
 * 멤버 참조(owner/assignees)는 이메일 id — DB엔 members 테이블 없음(디렉토리가 원천).
 */

// 논리 테이블명 → 물리 테이블명. 컷오버 시 '_v2'를 ''로 바꾸면 기본명 사용.
export const TBL = {
  tasks: 'tasks_v2', projects: 'projects_v2', archive: 'archive_v2', rituals: 'rituals_v2',
};

// 저장할 컬럼 순서(부모 projects → 자식). pull/push·스냅샷이 이 순서를 사용.
export const SYNC_KEYS = ['projects', 'tasks', 'archive', 'rituals'];

const nn = v => (v === '' || v === undefined) ? null : v; // '' / undefined → null (date·text 컬럼용)

export const FROM = {
  projects: r => ({
    ...(r.extra || {}),
    id: r.id, name: r.name, color: r.color,
    start: r.start || '', end: r.end || '',
    owner: r.owner_id || null, archived: !!r.archived,
  }),
  tasks: r => ({
    ...(r.extra || {}), // assignees[], milestones[], files[], requestedAt, slackTs/…, notionId 등
    id: r.id, project: r.project_id || '', kind: r.kind, status: r.status,
    tlStatus: r.tl_status || undefined, priority: r.priority, requester: r.requester ?? '',
    title: r.title, due: r.due || '', doneAt: r.done_at || undefined,
    createdAt: r.created_at || undefined, link: r.link ?? '', notes: r.notes ?? '',
    mt: r.mt || undefined,
  }),
  archive: r => ({
    ...(r.extra || {}), // tags[]
    id: r.id, kind: r.kind, title: r.title, url: r.url, owner: r.owner_id || null,
    project: r.project ?? '', version: r.version ?? '', date: r.date || '',
    notes: r.notes ?? '', author: r.author ?? '',
  }),
  // 리추얼은 문서형 — 본문 전체가 extra. 그대로 복원.
  rituals: r => ({ ...(r.extra || {}) }),
};

export const TO = {
  projects: p => {
    const { id, name, color, start, end, owner, archived, ...extra } = p;
    return {
      id: String(id), name: name ?? null, color: color ?? null,
      start: nn(start), end: nn(end), owner_id: owner || null, archived: !!archived, extra,
    };
  },
  tasks: t => {
    const { id, project, kind, status, tlStatus, priority, requester, title, due,
      doneAt, createdAt, link, notes, mt, ...extra } = t;
    return {
      id: String(id), project_id: project || null, kind: kind ?? null, status: status ?? null,
      tl_status: tlStatus || null, priority: priority ?? null, requester: nn(requester),
      title: title ?? null, due: nn(due), done_at: nn(doneAt), created_at: nn(createdAt),
      link: nn(link), notes: nn(notes), mt: nn(mt), extra,
    };
  },
  archive: a => {
    const { id, kind, title, url, owner, project, version, date, notes, author, ...extra } = a;
    return {
      id: String(id), kind: kind || 'asset', title: title ?? null, url: url ?? null,
      owner_id: owner || null, project: nn(project), version: nn(version), date: nn(date),
      notes: nn(notes), author: nn(author), extra,
    };
  },
  rituals: r => ({
    id: String(r.id), type: r.type ?? null, date: nn(r.date), quarter: r.quarter ?? null, extra: r,
  }),
};
