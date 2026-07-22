-- Refilled Design Hub — 관계형 재설계 스키마 (Expand-Contract 신규 테이블)
-- 기존 schema.sql(id/data jsonb 통짜)과 나란히 생성 → 이관 → 검증 → 컷오버.
-- 컷오버 전까지 옛 테이블은 무영향. 이 파일은 신규 프로젝트/스테이징의 SQL Editor에서 실행하세요.
--
-- 설계 요약:
--  · 단일 참조 중 "진짜 우리 것"인 project 참조만 DB FK (ON DELETE SET NULL).
--  · members 테이블 없음 — 구성원은 디렉토리 API(data.constanthub.kr)가 원천.
--    owner_id / extra.assignees[] 는 이메일을 id로 저장하고 표시 시점에 디렉토리로 해석.
--  · 배열(assignees/tags/milestones)·문서형(rituals 본문)은 extra jsonb 유지.
--  · app_state(config)·guard_log 는 기존 schema.sql 그대로 사용(신규 불필요).

-- ── 공통: updated_at 자동 갱신 트리거 함수 (기존과 동일, 자기완결 위해 재정의) ──
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── projects_v2 : 프로젝트 (타임라인 바) ──────────────────────────────
create table if not exists projects_v2 (
  id         text primary key,
  name       text,
  color      text,
  start      date,
  "end"      date,
  owner_id   text,                                  -- 이메일(디렉토리로 해석), FK 없음
  archived   boolean not null default false,
  extra      jsonb   not null default '{}',         -- 나머지 유동 필드
  updated_at timestamptz not null default now()
);

-- ── tasks_v2 : 업무 보드 카드 (요청/프로젝트 업무) ─────────────────────
create table if not exists tasks_v2 (
  id         text primary key,
  project_id text references projects_v2(id) on delete set null,  -- 유일한 DB FK
  kind       text,                                  -- 'request' | 'project'
  status     text,                                  -- 'req' | 'confirm' | 'done' ...
  tl_status  text,                                  -- 'wait' | 'doing' | 'done'
  priority   text,
  requester  text,                                  -- 요청자 이름(자유 문자열)
  title      text,
  due        date,
  done_at    date,
  created_at timestamptz,
  link       text,
  notes      text,
  extra      jsonb   not null default '{}',         -- assignees[](이메일)/milestones[]/files[]/slack앵커
  mt         timestamptz,                           -- 편집 시각(낙관적 동시성)
  updated_at timestamptz not null default now()
);

-- ── archive_v2 : 최종 파일 아카이브 + 인사이트(kind='insight') ─────────
create table if not exists archive_v2 (
  id         text primary key,
  kind       text not null default 'asset',         -- 'asset' | 'insight'
  title      text,
  url        text,
  owner_id   text,                                  -- 이메일(디렉토리로 해석), FK 없음
  project    text,                                  -- 자유 텍스트(현행 유지 — 정규화는 별건)
  version    text,
  date       date,
  notes      text,
  author     text,                                  -- 인사이트 작성자 이름(자유 문자열)
  extra      jsonb   not null default '{}',         -- tags[]
  updated_at timestamptz not null default now()
);

-- ── rituals_v2 : 위클리 리추얼 문서 (문서형 — 본문은 extra 유지) ───────
create table if not exists rituals_v2 (
  id         text primary key,
  type       text,                                  -- 'goals' | 'goals-config' | 'pulse'
  date       date,
  quarter    text,                                  -- 'YYYY-Qn' (goals-config)
  extra      jsonb not null,                        -- 문서 본문 전체
  updated_at timestamptz not null default now()
);

-- ── 인덱스 ────────────────────────────────────────────────────────────
create index if not exists idx_tasks_v2_project     on tasks_v2 (project_id);
create index if not exists idx_tasks_v2_kind_status on tasks_v2 (kind, status);
create index if not exists idx_tasks_v2_due         on tasks_v2 (due);
create index if not exists idx_tasks_v2_assignees   on tasks_v2 using gin ((extra -> 'assignees'));
create index if not exists idx_tasks_v2_milestones  on tasks_v2 using gin ((extra -> 'milestones'));
create index if not exists idx_projects_v2_owner    on projects_v2 (owner_id);
create index if not exists idx_archive_v2_kind      on archive_v2 (kind);
create index if not exists idx_archive_v2_owner     on archive_v2 (owner_id);
create index if not exists idx_archive_v2_tags      on archive_v2 using gin ((extra -> 'tags'));
create index if not exists idx_rituals_v2_type_date on rituals_v2 (type, date);

-- ── RLS + 정책 + updated_at 트리거 (기존 schema.sql 패턴 복제) ─────────
-- 사내 구성원(브릿지 인증 사용자)만 접근. 정책 없으면 기본 차단이라 안전한 방향으로 실패.
do $$
declare t text;
begin
  foreach t in array array['projects_v2','tasks_v2','archive_v2','rituals_v2'] loop
    execute format('alter table %I enable row level security', t);
    execute format($f$
      do $p$ begin
        create policy "authenticated only" on %I
          for all
          using (auth.role() = 'authenticated')
          with check (auth.role() = 'authenticated');
      exception when duplicate_object then null; end $p$;
    $f$, t);
    execute format($f$
      do $p$ begin
        create trigger %I before update on %I
          for each row execute function set_updated_at();
      exception when duplicate_object then null; end $p$;
    $f$, 'trg_' || t || '_updated', t);
  end loop;
end $$;

-- 주의: FK는 tasks_v2.project_id → projects_v2 하나뿐.
--  · 프로젝트 삭제 시 연결 업무는 네이티브 ON DELETE SET NULL 로 project_id=null 처리.
--  · 멤버는 테이블 자체가 없으므로 삭제 트리거 불필요 — 퇴사자 참조는 표시 시점 '미지정'으로 degrade.
