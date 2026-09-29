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

구독 모드는 워커 컨테이너 안에 공식 CLI와 계정 주인 로그인이 있어야 한다. 아직 설치하지 않았다(P1 전 결정). 그 전에는 API 모드 또는 AI 꺼짐.

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
