"use client";
import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action}>
      <label htmlFor="email">이메일</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">비밀번호</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {error && <p className="err">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={pending}>{pending ? "확인 중…" : "로그인"}</button>
      </div>
    </form>
  );
}
