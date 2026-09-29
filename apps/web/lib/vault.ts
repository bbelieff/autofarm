import "server-only";
import { createVault, mask, type Vault } from "@autofarm/vault";
import { env } from "./env";

let v: Vault | null = null;
export function vault(): Vault {
  if (!v) v = createVault({ masterKey: env.vaultMasterKey() });
  return v;
}
export { mask };
