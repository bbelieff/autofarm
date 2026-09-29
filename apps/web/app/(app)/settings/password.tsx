"use client";
import { useActionState } from "react";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [msg, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="card">
      <h3>비밀번호 변경</h3>
      <div className="row">
        <div>
          <label htmlFor="current">현재 비밀번호</label>
          <input id="current" name="current" type="password" autoComplete="current-password" required />
        </div>
        <div>
          <label htmlFor="next">새 비밀번호(10자 이상)</label>
          <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
        </div>
      </div>
      {msg && <p className={msg.startsWith("바꿨") ? "muted" : "err"}>{msg}</p>}
      <div className="actions">
        <button disabled={pending}>{pending ? "변경 중…" : "변경"}</button>
      </div>
    </form>
  );
}
