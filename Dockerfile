# 웹·워커·마이그레이션 공용 이미지 (VPS 한 대, 소규모)
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@10.34.6 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
# AI 구독 연결용 공식 CLI (워커가 워크스페이스별 로그인 폴더로 실행)
RUN npm i -g @anthropic-ai/claude-code@2.1.284 @openai/codex@0.159.0  && mkdir -p /opt/muse /data/ai  && curl -fsSL https://api.meta.ai/muse-launcher.sh -o /opt/muse/muse && chmod 755 /opt/muse/muse  && chown -R node:node /opt/muse /data/ai
ENV CLAUDE_BIN=claude CODEX_BIN=codex MUSE_BIN=/opt/muse/muse AI_HOME=/data/ai
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
COPY packages/vault/package.json packages/vault/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @autofarm/web build
USER node
CMD ["pnpm", "--filter", "@autofarm/web", "start"]
