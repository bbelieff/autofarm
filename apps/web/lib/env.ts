function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 이(가) 필요합니다 (.env 참고)`);
  return v;
}
export const env = {
  databaseUrl: () => need("DATABASE_URL"),
  vaultMasterKey: () => need("VAULT_MASTER_KEY"),
};
