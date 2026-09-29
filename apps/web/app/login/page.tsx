import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <div className="login card">
      <h2>오토농장</h2>
      <p className="sub">초대받은 계정으로 로그인하세요.</p>
      <LoginForm />
    </div>
  );
}
