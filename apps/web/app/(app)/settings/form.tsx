"use client";
import { useActionState } from "react";
import type { ParamField, ParamGroup, SourcingParams } from "@autofarm/config";
import { resetParams, saveBusiness, saveParams } from "./actions";

type BusinessProps = { name: string; businessName: string; businessNo: string; taxType: string };

export function BusinessForm(p: BusinessProps) {
  const [msg, action, pending] = useActionState(saveBusiness, null);
  return (
    <form action={action} className="card">
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
      {msg && <p className={msg.startsWith("저장") ? "muted" : "err"}>{msg}</p>}
      <div className="actions"><button disabled={pending}>{pending ? "저장 중…" : "저장"}</button></div>
    </form>
  );
}

type ParamsProps = {
  groups: ParamGroup[];
  fields: ParamField[];
  values: SourcingParams;
  defaults: SourcingParams;
  source: "private" | "example";
};

const show = (f: ParamField, v: unknown) =>
  f.type === "boolean" ? (v ? "켬" : "끔") : f.type === "select" ? `…${v}` : `${Number(v).toLocaleString("ko-KR")}${f.unit ? ` ${f.unit}` : ""}`;

export function ParamsForm({ groups, fields, values, defaults, source }: ParamsProps) {
  const [msg, action, pending] = useActionState(saveParams, null);
  return (
    <div className="card">
      <h3>소싱 기준</h3>
      <p className="muted">
        기본값은 {source === "private" ? "교안 기준 프리셋" : "공개 예시 값(프리셋 파일 없음)"}입니다. 바꾼 항목만 이 워크스페이스에 저장되고, 소싱을 돌릴 때마다
        그때의 기준이 결과와 함께 기록됩니다.
      </p>
      <form action={action}>
        {groups.map((g) => (
          <fieldset key={g} style={{ border: "1px solid var(--line)", borderRadius: 8, margin: "14px 0", padding: "6px 14px 14px" }}>
            <legend style={{ fontWeight: 600, padding: "0 6px" }}>{g}</legend>
            <div className="row">
              {fields
                .filter((f) => f.group === g)
                .map((f) => {
                  const v = values[f.key];
                  const changed = v !== defaults[f.key];
                  const id = `p-${f.key}`;
                  return (
                    <div key={f.key}>
                      {f.type === "boolean" ? (
                        <label htmlFor={id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 18 }}>
                          <input id={id} name={f.key} type="checkbox" defaultChecked={Boolean(v)} style={{ width: "auto" }} />
                          {f.label}
                        </label>
                      ) : (
                        <>
                          <label htmlFor={id}>
                            {f.label}
                            {f.type === "number" && f.unit ? ` (${f.unit})` : ""}
                          </label>
                          {f.type === "select" ? (
                            <select id={id} name={f.key} defaultValue={String(v)}>
                              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : (
                            <input id={id} name={f.key} type="number" min={f.min} max={f.max} step="any" defaultValue={String(v)} />
                          )}
                        </>
                      )}
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {f.help} · 기본 {show(f, defaults[f.key])}
                        {changed && <b style={{ color: "var(--warn)" }}> · 변경됨</b>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </fieldset>
        ))}
        {msg && <p className={msg.startsWith("저장") ? "muted" : "err"}>{msg}</p>}
        <div className="actions">
          <button disabled={pending}>{pending ? "저장 중…" : "기준 저장"}</button>
          <button type="submit" formAction={resetParams} className="ghost" formNoValidate>
            교안 기본값으로 되돌리기
          </button>
        </div>
      </form>
    </div>
  );
}
