# 오토농장 (AutoFarm)

농수산물 **위탁판매 한 바퀴**를 자동화하는 SaaS입니다.
소싱(수요 발굴 → 진입 시점 → 공급처 매칭 → 판매가) → 이미지·상세페이지 → 쿠팡·당근 등록 → 발주·송장 → 정산·손익·세무 자료까지.

- 설계서: [docs/design.md](docs/design.md) · AI 프로바이더: [docs/ai-providers.md](docs/ai-providers.md) · 운영: [docs/runbook.md](docs/runbook.md)
- 진행 관리: [Issues](../../issues) · [Milestones](../../milestones) (P0 기반 → P1 소싱 MVP → P2 소재·상세 → P3 등록·발주 → P4 재무·세무 → P5 체험판)
- 상태: **P0 기반 개발 중**

## 구조

```
apps/web            Next.js 16 — 로그인, 연결 설정(S0), 워크스페이스 설정, 작업 기록, 관리자 AI 설정
apps/worker         pg-boss 작업 실행기 — 연결 점검, 만료 비밀 파기, AI 연결 시험
packages/db         Drizzle 스키마·마이그레이션·워크스페이스 범위 저장소, 로컬/테스트용 embedded-postgres
packages/auth       scrypt 비밀번호, DB 세션
packages/jobs       작업 큐(멱등 키·재시도·dead)
packages/vault      봉투 암호화(AES-256-GCM), 로그 가림
packages/connectors 커넥터 공통 틀, 속도 제한, 픽스처 스크러버
packages/ai         Claude·Codex·Muse·Gemini × 구독/API
packages/config     발굴 프리셋·공급처 시드 로더(비공개 파일은 커밋 금지)
```

## 로컬 실행 (설치 없이 — Postgres도 npm 패키지로 뜸)

```bash
pnpm install
node scripts/make-local-env.mjs          # .env 생성(무작위 테스트 키, 커밋 안 됨)
pnpm db:start                            # 터미널 1: 로컬 Postgres(127.0.0.1:54329)
pnpm db:migrate
NEW_USER_PASSWORD=<10자 이상> pnpm --filter @autofarm/db user:add --email you@example.com --name 이름 --workspace 내농장 --admin
pnpm dev:worker                          # 터미널 2
pnpm dev                                 # 터미널 3: http://localhost:3310
```

- 검사: `pnpm typecheck` · `pnpm lint` · `pnpm test` (DB 테스트는 임시 Postgres를 스스로 띄웁니다)
- Claude 구독 모드를 로컬에서 쓰려면 `.env`의 `CLAUDE_BIN`에 claude 실행 파일 경로를 넣습니다.

## 원칙

- 공식 API 우선, 없으면 사용자 본인 계정의 로그인 세션으로 수집(저속·최소, 동의·보관 기간 기록).
- 모든 숫자에 출처와 조회 시각을 붙입니다.
- 비밀값·공급처 개별 정보·비공개 프리셋은 레포에 넣지 않습니다 (`config/*.example.json`만 공개). CI가 커밋을 막습니다.
