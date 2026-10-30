# KISTI Policy Review

3명의 평가자가 각자 판단을 기록하고, 관리자는 답변을 보지 않은 채 진행률을 확인하는 React + TypeScript + Vite 앱입니다. Supabase Auth·PostgreSQL·Realtime 연결 코드와 GitHub Pages 배포 워크플로를 포함합니다.

현재는 **합성 데이터 파일럿**입니다. Supabase 프로젝트가 없어도 로컬 연습이 동작합니다. 실제 회의록과 평가표를 가져오면 이 기기의 IndexedDB에만 보관하며, 원문과 파생 라벨의 온라인 동기화·최종 제출은 차단합니다. 대회 데이터 저장 허용 범위가 확인되기 전에는 이 제한을 해제하지 마세요.

## 팀원 접속 방식

팀원 이메일 계정을 미리 만들 필요가 없습니다. 관리자가 전달하는 **본인 참여 링크**를 열어 이름과 비밀번호를 설정하면 바로 평가를 시작합니다. 이후에는 팀원 자리와 이름·비밀번호로 이어서 작업하며, 이미 접속한 브라우저는 저장된 세션을 복원합니다. 관리자도 별도 비공개 참여 링크를 사용합니다.

배포 설치는 [이름·비밀번호 접속 설정](docs/SELF_SERVICE_SETUP.md)을 따릅니다. `.env.local`에는 공개 Supabase URL·publishable 키만 있으면 됩니다. 아래 수동 UID 배정 안내는 기존 이메일 계정을 사용할 때의 선택 경로입니다.

## 시작

Node.js 24와 pnpm 11을 사용합니다. 이 디렉터리에서 실행하세요.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

터미널에 표시된 로컬 주소를 열고 기본 공식 모드의 R1·R2·H1 합성 연습 또는 관리자 합성 대시보드를 선택합니다. 환경변수 없이 실행하면 기본 주소는 `http://127.0.0.1:5173/`입니다. 연습 모드는 브라우저 로컬 저장소를 사용하므로 중앙 DB나 다른 기기와 공유되지 않습니다.

공식 배정은 R1 81, R2 24, H1 68, R1_DEDUP 8, S1 300, C1 10으로 총 491건입니다. 기본 3인 배정에서 R1 평가자가 R1_DEDUP·S1, R2 평가자가 C1을 함께 담당합니다. 이 공식 설계는 기본 모드로 유지됩니다.

선택 모드 **3인 균등 분담**은 여섯 원천 그룹 각각을 세 팀원에게 나눕니다. 로그인 후 이 모드를 선택하면 해당 계정에 배정된 팀원 작업만 표시됩니다. 합성 연습의 R1·R2·H1 선택지는 각각 팀원 1·2·3에 대응합니다. R1과 R2는 모두 블라인드 평가이지만 서로 다른 작업 종류로 유지됩니다. 이 공유 분담 모드는 각 평가자가 같은 항목을 독립적으로 검토하는 프로토콜을 제공하지 않습니다. 독립 검토가 필요한 공식 연구에는 기본 공식 설계를 사용하세요.

| 원천 그룹 | 팀원 1 | 팀원 2 | 팀원 3 |
| --- | ---: | ---: | ---: |
| R1 | 27 | 27 | 27 |
| R2 | 8 | 8 | 8 |
| H1 | 23 | 23 | 22 |
| 주요 작업 소계 | **58** | **58** | **57** |
| R1_DEDUP | 3 | 2 | 3 |
| S1 | 100 | 100 | 100 |
| C1 | 3 | 4 | 3 |
| 전체 합계 | **164** | **164** | **163** |

각 그룹은 원천 행 순서에 따라 서로 겹치지 않는 연속 구간으로 배정됩니다. 이 모드는 별도 합성 프로젝트의 `B1_R1`부터 `B3_C1`까지 18개 배정을 사용합니다. 이전 15개 배정의 균등 분담 실험 데이터는 보존되지만 새 모드 목록에는 표시되지 않습니다.

## 저장과 복구

- 변경 즉시 IndexedDB에 초안을 기록하고, 750ms debounce 후 서버에 저장합니다. 항목·작업 이동과 로그아웃은 로컬 기록과 저장 시도를 먼저 마칩니다.
- 저장 중·저장 완료·미동기화·저장 실패·충돌을 구분합니다. 저장 완료와 완료율에는 서버가 확인한 유효한 라벨만 반영합니다.
- 연결 복구 및 재로그인 시 미전송 작업을 재시도합니다. 같은 항목의 version 충돌은 서버 값·내 초안·직접 병합 중 선택하여 해결합니다.
- 같은 브라우저의 여러 탭은 Web Locks로 작업별 단일 편집을 보장합니다. 대기 탭은 잠금이 풀리면 자동 재개합니다. Web Locks를 지원하지 않는 환경에서는 편집을 차단합니다. IndexedDB는 브라우저의 저장 공간 삭제·시크릿 세션 종료까지 보장하는 백업은 아닙니다.
- Supabase 연결 시 로그인 세션을 복원하고 서버의 최신 라벨을 읽습니다. 다른 기기의 미전송 초안은 그 기기에서 온라인 동기화를 마쳐야 합니다.
- 관리자 구독은 안전한 `review_progress` 요약에 한정합니다. 재연결 시 서버를 재조회하고, 10초 간격 조회를 보조로 사용합니다.

필수 필드와 조건부 빈 값은 `src/domain.ts`와 SQL에서 검증합니다. 예를 들어 R1/R2의 yes는 11개 중 행위 유형과 근거 지지 여부가 모두 필요하며, 일부만 작성한 행은 작성 중으로 집계합니다. 이 앱은 사람이 입력하는 평가 도구이고 AI 예비평가를 사람 평가로 바꾸는 도구가 아닙니다.

## Supabase 연결

[전체 설정 절차](docs/SUPABASE.md)에 따라 프로젝트, 평가자 3명과 관리자 1명을 만들고 migration과 합성 seed를 적용합니다. 3인 균등 분담을 사용하려면 기존 migration 다음에 `202610300002_team_split.sql`을 적용하고 별도의 `synthetic_team_split.sql` seed를 실행합니다. `.env.example`을 `.env.local`로 복사한 뒤 아래 이름을 설정하세요.

```text
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_BASE_PATH=/
```

`.env.local`은 Git에서 제외됩니다. 브라우저에 전달하는 키는 publishable 키만 사용합니다. Secret/service_role 키를 `VITE_` 변수에 넣지 마세요. [Supabase 키 지침](https://supabase.com/docs/guides/getting-started/api-keys)에 맞춰 서버 전용 테스트 키는 CLI에서만 사용합니다.

연결 후 일회용 합성 프로젝트에서 실제 DB 저장·재조회·RLS·Auth 재로그인·Realtime·제출 잠금을 시험하려면, 비공개 `.env.local` 또는 CLI 환경에 `SUPABASE_TEST_SECRET_KEY`와 `RUN_SUPABASE_INTEGRATION=1`을 추가하고 실행합니다.

```sh
pnpm test:supabase
```

러너는 자신이 생성한 합성 사용자와 프로젝트만 정리합니다. 연결 정보가 없으면 **SKIP / NOT RUN**을 출력합니다. 이 상태는 통합 테스트 통과가 아닙니다. 실제 브라우저 종료와 물리적 다른 기기 시험은 별도로 수행해야 합니다.

## CSV 가져오기와 제출 결과

평가자는 배정 화면에서 로컬 CSV를 가져올 수 있습니다. 행 수·고유 ID·헤더·CSV 구조를 검사하며, 출처와 인용문은 전송하지 않습니다. 3인 균등 분담에서는 해당 원천 그룹의 전체 CSV를 가져오면 선택한 팀원의 연속 행 구간을 자동 선택합니다. 팀원별로 이미 분할한 CSV도 가져올 수 있습니다. 원본 셀·ID·행 순서는 유지합니다. 가져온 자료는 실데이터로 취급하므로 온라인 저장과 최종 제출이 비활성화됩니다.

합성 온라인 세션은 모든 필수 라벨이 서버에 저장되고 미동기화·충돌이 없을 때 제출할 수 있습니다. 서버가 재검증한 뒤 세션을 잠급니다. 관리자는 **제출 잠금과 블라인드 종료가 모두 확인된 후** 라벨을 내려받아 관리자 기기의 원본 CSV에 병합합니다. 3인 균등 분담의 그룹별 병합은 세 팀원의 세션이 모두 잠긴 후에 진행해야 합니다. 원본 헤더·행 순서·ID·원문 셀을 보존하고 기존 채점 수식을 변경하지 않습니다.

다운로드 후 로컬에서 확인할 수 있습니다. 공식 연구 저장소가 있는 환경에서는 해당 검증기를 추가로 호출하며 수정하지 않습니다.

```sh
python3 scripts/verify_csv.py blind --sheet /absolute/original.csv --labels /absolute/returned.csv --research-root /absolute/research-repository
```

평가 종류는 `blind`, `e3b`, `dedup`, `sample`, `committee`입니다. E3-B 검증기 경로 등 상세 옵션은 `python3 scripts/verify_csv.py --help`에서 확인하세요. 원본과 결과 CSV는 이 소스 디렉터리 밖의 비공개 데이터 구역에 두세요.

## 검증

```sh
pnpm test
pnpm build
pnpm check:secrets
pnpm test:export
pnpm test:supabase
```

[검증 결과와 남은 실제 연결 시험](docs/VERIFICATION.md)에 실행 범위를 구분해 기록했습니다. SQL 시험은 실제 migration을 로컬 PGlite PostgreSQL 엔진에서 실행합니다. Supabase 클라우드·Auth 서비스·Realtime 네트워크까지 대체한 시험으로 보고하지 않습니다.

## GitHub Pages

이 디렉터리 자체를 새 저장소 `kisti-policy-review-web`의 루트로 사용합니다. `.github/workflows/ci.yml`은 합성 테스트·빌드·키 검사, `pages.yml`은 Pages 배포를 정의합니다. 공개 저장소는 https://github.com/uiseokys/kisti-policy-review-web 이며 실제 배포 상태는 GitHub Actions에서 확인합니다.

1. GitHub 저장소의 **Settings → Pages → Source → GitHub Actions**를 선택합니다.
2. 온라인 합성 시험을 하려면 **Settings → Secrets and variables → Actions → Variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 설정합니다. 비공개 키는 등록하지 않습니다. 미설정이면 로컬 합성 연습 화면으로 빌드됩니다.
3. Supabase Auth의 Site URL과 필요한 Redirect URL을 배포 주소 `https://YOUR-ACCOUNT.github.io/kisti-policy-review-web/`에 맞춥니다.
4. 승인된 코드만 main 브랜치에 올린 뒤 워크플로를 실행합니다. 배포 빌드는 자동으로 저장소 이름에 맞는 base path를 적용합니다. 사용자 도메인 루트 배포 시에는 `pages.yml`의 `VITE_BASE_PATH`를 `/`로 변경해야 합니다.

[Vite의 GitHub Pages 배포 지침](https://vite.dev/guide/static-deploy.html#github-pages)과 [Supabase Realtime 지침](https://supabase.com/docs/guides/realtime/postgres-changes)을 참고했습니다. 배포 artifact는 `dist`만 포함합니다. 실데이터 CSV·원문·대응표·`.env.local`은 저장소나 배포물에 포함하지 마세요.
