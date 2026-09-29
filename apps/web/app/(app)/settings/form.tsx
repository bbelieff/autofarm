"use client";
import { useActionState } from "react";
import { saveSettings } from "./actions";
import type { WorkspaceParams } from "@/lib/params";

type Props = { name: string; businessName: string; businessNo: string; taxType: string; params: WorkspaceParams };

export function SettingsForm(p: Props) {
  const [msg, action, pending] = useActionState(saveSettings, null);
  return (
    <form action={action}>
      <div className="card">
        <h3>사업자</h3>
        <div className="row">
          <div><label htmlFor="name">워크스페이스 이름</label><input id="name" name="name" defaultValue={p.name} required /></div>
          <div><label htmlFor="businessName">상호</label><input id="businessName" name="businessName" defaultValue={p.businessName} /></div>
          <div><label htmlFor="businessNo">사업자번호</label><input id="businessNo" name="businessNo" defaultValue={p.businessNo} /></div>
          <div>
            <label htmlFor="taxType">과세유형</label>
            <select id="taxType" name="taxType" defaultValue={p.taxType}>
              <option value="general">일반과세자 (부가세 1·7월)</option>
              <option value="simple">간이과세자 (부가세 1월)</option>
            </select>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>소싱 파라미터</h3>
        <div className="row">
          <div><label htmlFor="entryPercent">진입 % (피크=100 기준)</label><input id="entryPercent" name="entryPercent" type="number" step="1" defaultValue={p.params.entryPercent} /></div>
          <div><label htmlFor="leadDays">리드타임(일) — 등록 권장일 = 진입일 − 리드타임</label><input id="leadDays" name="leadDays" type="number" defaultValue={p.params.leadDays} /></div>
          <div><label htmlFor="feeDaangn">당근 수수료율</label><input id="feeDaangn" name="feeDaangn" type="number" step="0.001" defaultValue={p.params.feeDaangn} /></div>
          <div><label htmlFor="feeCoupang">쿠팡 수수료율</label><input id="feeCoupang" name="feeCoupang" type="number" step="0.001" defaultValue={p.params.feeCoupang} /></div>
          <div><label htmlFor="couponCoupang">쿠팡 쿠폰액(원)</label><input id="couponCoupang" name="couponCoupang" type="number" step="100" defaultValue={p.params.couponCoupang} /></div>
        </div>
        {msg && <p className={msg === "저장했습니다" ? "muted" : "err"}>{msg}</p>}
        <div className="actions"><button disabled={pending}>{pending ? "저장 중…" : "저장"}</button></div>
      </div>
    </form>
  );
}
