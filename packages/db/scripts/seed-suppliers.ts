// config/suppliers.private.json(커밋 금지)의 공급처를 한 워크스페이스에 넣는다. 이미 있는 이름은 건너뛴다.
// 사용: pnpm --filter @autofarm/db seed:suppliers --workspace <워크스페이스 이름>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { loadSupplierSeeds } from "@autofarm/config";
import { createDb } from "../src/client";
import { suppliers, workspaces } from "../src/schema";

try {
  process.loadEnvFile("../../.env");
} catch {
  // .env 없으면 환경변수만 사용
}

const { values } = parseArgs({ options: { workspace: { type: "string" } } });
const url = process.env.DATABASE_URL;
if (!url || !values.workspace) throw new Error("DATABASE_URL, --workspace 가 필요합니다");
const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config");
const seeds = loadSupplierSeeds(configDir);
const { db, close } = createDb(url, { max: 1 });
const [ws] = await db.select().from(workspaces).where(eq(workspaces.name, values.workspace));
if (!ws) throw new Error(`워크스페이스 없음: ${values.workspace}`);
const rows = seeds.length
  ? await db
      .insert(suppliers)
      .values(
        seeds.map((s) => ({
          workspaceId: ws.id,
          name: s.name,
          platform: s.platform,
          siteUrl: s.siteUrl ?? null,
          orderPageUrl: s.orderPageUrl ?? null,
          cardPayment: s.cardPayment ?? null,
          config: s.config ?? {},
        })),
      )
      .onConflictDoNothing()
      .returning({ id: suppliers.id })
  : [];
console.warn(`공급처 ${seeds.length}개 중 ${rows.length}개 추가`);
await close();
