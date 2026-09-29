import { requireWorkspace } from "@/lib/session";
import { readParams } from "@/lib/params";
import { SettingsForm } from "./form";
import { PasswordForm } from "./password";

export default async function SettingsPage() {
  const { workspace } = await requireWorkspace();
  return (
    <>
      <h2>워크스페이스 설정</h2>
      <p className="sub">과세유형은 부가세 자료 서식을 정합니다. 소싱 파라미터는 실행할 때마다 스냅샷으로 저장됩니다.</p>
      <SettingsForm
        name={workspace.name}
        businessName={workspace.businessName ?? ""}
        businessNo={workspace.businessNo ?? ""}
        taxType={workspace.taxType}
        params={readParams(workspace.settings)}
      />
      <PasswordForm />
    </>
  );
}
