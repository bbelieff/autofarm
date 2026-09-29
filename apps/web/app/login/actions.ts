"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createSession, SESSION_COOKIE, verifyPassword } from "@autofarm/auth";
import { schema, workspacesOfUser } from "@autofarm/db";
import { db } from "@/lib/db";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email));
  // 계정 유무를 드러내지 않도록 같은 문구
  if (!user || !(await verifyPassword(password, user.passwordHash))) return "이메일 또는 비밀번호가 맞지 않습니다";
  const ws = (await workspacesOfUser(db(), user.id))[0];
  const { token, expiresAt } = await createSession(db(), user.id, ws?.id ?? null);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  redirect("/");
}
