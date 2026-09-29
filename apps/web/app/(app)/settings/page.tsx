import { PARAM_FIELDS, PARAM_GROUPS } from "@autofarm/config";
import { requireWorkspace } from "@/lib/session";
import { defaultParams, readParams } from "@/lib/params";
import { BusinessForm, ParamsForm } from "./form";
import { PasswordForm } from "./password";

export default async function SettingsPage() {
  const { workspace } = await requireWorkspace();
  const { defaults, source } = defaultParams();
  return (
    <>
      <h2>워크스페이스 설정</h2>
      <p className="sub">과세유형은 부가세 자료 서식을 정합니다. 소싱 기준은 이 워크스페이스에서 아이템을 고를 때 쓰입니다.</p>
      <BusinessForm
        name={workspace.name}
        businessName={workspace.businessName ?? ""}
        businessNo={workspace.businessNo ?? ""}
        taxType={workspace.taxType}
      />
      <ParamsForm groups={PARAM_GROUPS} fields={PARAM_FIELDS} values={readParams(workspace.settings)} defaults={defaults} source={source} />
      <PasswordForm />
    </>
  );
}
