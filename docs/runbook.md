# 운영 런북

> 서버: 기존 VPS(다른 서비스와 공존). **오토농장 영역(`/opt/autofarm`, 컨테이너 `autofarm-*`, 포트 3320·8443) 밖은 건드리지 않는다.**

## 1. 구성

| 항목 | 값 |
|---|---|
| 위치 | `/opt/autofarm/prod` (레포 클론) · 설정 `/opt/autofarm/prod/deploy/.env` (커밋 금지, 권한 600) |
| 컨테이너 | `autofarm-prod-db`(256MB) · `autofarm-prod-web`(512MB, 127.0.0.1:3320) · `autofarm-prod-worker`(512MB) · `migrate`(1회) |
| 접속 | Tailscale 전용 `https://<서버 ts.net 이름>:8443` → `tailscale serve --bg --https=8443 http://127.0.0.1:3320` (443은 공용 Caddy가 사용) |
| 데이터 | `deploy/pgdata/` (Postgres 18) |

## 2. 배포

```bash
cd /opt/autofarm/prod && git pull --ff-only
cd deploy && docker compose build && docker compose up -d
docker compose ps && docker compose logs --tail 30 web worker
```

## 3. 처음 설치

```bash
git clone https://github.com/bbelieff/autofarm.git /opt/autofarm/prod
cd /opt/autofarm/prod/deploy && umask 077 && cat > .env   # 아래 키 채우기
# 교안 기준 프리셋(비공개): 운영자 PC 의 config/presets.private.json 을 서버 /opt/autofarm/prod/config/ 에 복사(없으면 docker 가 폴더를 만들어 실패)
mkdir -p ai-home && chown 1000:1000 ai-home && chmod 700 ai-home
docker compose up -d --build
tailscale serve --bg --https=8443 http://127.0.0.1:3320
```

`.env` 키: `POSTGRES_PASSWORD` · `DATABASE_URL=postgres://autofarm:<같은 비밀번호>@db:5432/autofarm` · `VAULT_MASTER_KEY`(32바이트 base64) · `SESSION_SECRET`

- **마스터 키는 VPS 밖에도 보관한다**(운영자 PC 비공개 위치). 잃으면 저장된 연결 비밀을 모두 다시 입력해야 한다.

## 4. 계정 추가(초대)

```bash
cd /opt/autofarm/prod/deploy
docker compose run --rm -e NEW_USER_PASSWORD='<임시 비밀번호>' migrate \
  pnpm --filter @autofarm/db user:add --email 친구@메일 --name 친구 --workspace 친구농장 --tax simple
```

받은 사람은 로그인 후 「워크스페이스 설정 → 비밀번호 변경」으로 바꾼다.

## 5. AI 구독 모드(서버)

- 워커 이미지에 공식 CLI가 들어 있다: Claude Code(`claude`), Codex(`codex`), Muse(`/opt/muse/muse`, 첫 실행 때 본체를 내려받음).
- 로그인 정보는 워크스페이스·프로바이더별 폴더 `deploy/ai-home/<워크스페이스ID>/<프로바이더>/` 에 저장된다(호스트 소유자 uid 1000, 권한 700). 연결 해제 시 폴더를 지운다.
- 연결은 화면에서: 「AI 설정 → AI 연결」
  - Codex·Muse: 「자동 연결」 → 링크·코드 → 브라우저에서 승인 → 자동으로 연결됨(최대 15분 대기)
  - Claude: 계정 주인 PC에서 `claude setup-token` → 토큰 붙여넣기(암호화 저장, 실행 때만 환경변수로 전달)
  - Gemini: API 키만
- 구독 연결은 그 요금제 계정 주인 본인의 워크스페이스에서만 쓴다.

## 6. 백업·복구

- 매일 03:30(KST) `/etc/cron.d/autofarm-backup` → `deploy/backup.sh`: `pg_dump | gzip | openssl AES-256`(암호 = `deploy/.env` 의 `BACKUP_PASSPHRASE`) → `/opt/autofarm/backups/` 7일 보관, 기록 `backup.log`.
- 복원: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:<암호> -in <파일> | gunzip | docker exec -i autofarm-prod-db psql -U autofarm autofarm`
- `.env`(마스터 키·백업 암호) 사본은 운영자 PC 비공개 폴더에 있다. VPS 밖으로 백업 파일을 옮기는 자동화는 #62.
- 복구 훈련: 분기 1회 로컬에서 덤프를 복원해 로그인·연결 목록 확인.

## 7. 멈춤·되돌리기

```bash
cd /opt/autofarm/prod/deploy && docker compose down          # 데이터는 pgdata 에 남음
tailscale serve --https=8443 off
```
