import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSession, SESSION_COOKIE } from "@autofarm/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db(), token);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
