/* drive-index.gs — 디자인팀 구글 드라이브 → 파일 파인더 인덱스 자동 생성
 *
 * 하는 일: "1300-ct-디자인팀" 드라이브 폴더 전체를 훑어서
 * 파일 목록(경로·이름·크기·수정일·드라이브 링크)을 JSON으로 만들고,
 * 허브 저장소의 data/fileindex.json 에 자동 커밋합니다.
 * 파일 파인더가 이 파일을 읽어 검색하고, 결과에 "드라이브에서 열기" 버튼이 생겨요.
 *
 * ── 설치 방법 (10분, 한 번만) ──────────────────────────────
 * 1. script.google.com 접속 → "새 프로젝트" → 이 파일 내용 전체 붙여넣기
 * 2. 왼쪽 ⚙️ 프로젝트 설정 → 아래 "스크립트 속성" → 속성 추가:
 *      GH_TOKEN = GitHub fine-grained PAT (Vercel에 넣은 것과 같은 토큰 재사용 가능)
 *      GH_REPO  = geunalee-tech/refilled-design_hub
 * 3. 에디터로 돌아와 함수 선택을 buildIndex 로 두고 ▶ 실행
 *      → 처음엔 구글 권한 승인 창이 떠요 (드라이브 읽기 + 외부 연결 허용)
 *      → 실행 로그에 "완료: 파일 N개" 가 나오면 성공
 * 4. 왼쪽 ⏰ 트리거 → "트리거 추가":
 *      실행할 함수 buildIndex / 이벤트 소스 "시간 기반" / "일 단위 타이머" / 새벽 1시~2시
 * 끝! 이후 매일 밤 자동으로 인덱스가 갱신됩니다.
 * ──────────────────────────────────────────────────────── */

var FOLDER_ID = '1HkwYnFzMr_OBXb6Lh0tTl0CH3-5kg1t2'; // 1300-ct-디자인팀
var BRANCH = 'main';
var MAX_FILES = 20000; // 안전 상한

function buildIndex() {
  var t0 = Date.now();
  var out = [];
  var root = DriveApp.getFolderById(FOLDER_ID);
  walk(root, root.getName(), out, t0);

  // 최신 수정 순 정렬
  out.sort(function (a, b) { return a.mtime < b.mtime ? 1 : -1; });

  var json = JSON.stringify(out);
  commitToGitHub('data/fileindex.json', json,
    'hub: 드라이브 파일 인덱스 갱신 (' + out.length + '개)');
  Logger.log('완료: 파일 ' + out.length + '개, ' + Math.round((Date.now() - t0) / 1000) + '초');
}

/* 폴더 재귀 순회 (Apps Script 실행 제한 6분 → 5분 넘으면 중단하고 있는 만큼 저장) */
function walk(folder, path, out, t0) {
  if (out.length >= MAX_FILES || Date.now() - t0 > 5 * 60 * 1000) return;

  var files = folder.getFiles();
  while (files.hasNext()) {
    if (out.length >= MAX_FILES) return;
    var f = files.next();
    var name = f.getName();
    var dot = name.lastIndexOf('.');
    out.push({
      path: path + '/' + name,
      name: name,
      ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
      size: f.getSize(),
      mtime: f.getLastUpdated().toISOString().slice(0, 10),
      url: 'https://drive.google.com/file/d/' + f.getId() + '/view',
    });
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    walk(sub, path + '/' + sub.getName(), out, t0);
  }
}

/* GitHub Contents API로 커밋 (기존 파일 있으면 sha 포함해 갱신) */
function commitToGitHub(filePath, content, message) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GH_TOKEN');
  var repo = props.getProperty('GH_REPO');
  if (!token || !repo) throw new Error('스크립트 속성 GH_TOKEN / GH_REPO 를 먼저 설정해주세요 (⚙️ 프로젝트 설정 → 스크립트 속성)');

  var url = 'https://api.github.com/repos/' + repo + '/contents/' + filePath;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  // 기존 파일 sha 조회
  var sha = null;
  var got = UrlFetchApp.fetch(url + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
  if (got.getResponseCode() === 200) sha = JSON.parse(got.getContentText()).sha;

  var body = {
    message: message,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  var res = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('GitHub 커밋 실패 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
}
