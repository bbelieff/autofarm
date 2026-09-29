#!/usr/bin/env bash
# 오토농장 prod DB 매일 백업: pg_dump → gzip → AES-256(암호는 deploy/.env 의 BACKUP_PASSPHRASE) → 7일 보관
# cron: /etc/cron.d/autofarm-backup (runbook §6)
set -euo pipefail
cd "$(dirname "$0")"
PASS=$(grep -E '^BACKUP_PASSPHRASE=' .env | cut -d= -f2-)
[ -n "$PASS" ] || { echo "BACKUP_PASSPHRASE 없음" >&2; exit 1; }
DIR=/opt/autofarm/backups
mkdir -p "$DIR" && chmod 700 "$DIR"
OUT="$DIR/autofarm-$(date +%Y%m%d-%H%M).sql.gz.enc"
docker exec autofarm-prod-db pg_dump -U autofarm autofarm | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:$PASS" > "$OUT"
chmod 600 "$OUT"
find "$DIR" -name 'autofarm-*.sql.gz.enc' -mtime +7 -delete
echo "백업 완료: $OUT ($(stat -c %s "$OUT") bytes)"
# 복원: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:<암호> -in <파일> | gunzip | psql ...
