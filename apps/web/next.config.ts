import type { NextConfig } from "next";

// 레포 루트 .env 를 함께 읽는다(웹·워커·스크립트가 같은 설정을 씀)
try {
  process.loadEnvFile("../../.env");
} catch {
  // 없으면 환경변수만 사용
}

const config: NextConfig = {
  transpilePackages: ["@autofarm/ai", "@autofarm/auth", "@autofarm/config", "@autofarm/db", "@autofarm/jobs", "@autofarm/vault"],
  serverExternalPackages: ["postgres", "pg-boss", "pg", "embedded-postgres"],
  poweredByHeader: false,
};
export default config;
