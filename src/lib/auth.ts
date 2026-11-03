import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { authSecret } from "./env";
import { ActionError } from "./errors";

export { ActionError };

export const SESSION_COOKIE = "anx_session";
const SESSION_HOURS = 8;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  psychologistId: string | null;
  canViewOthers: boolean;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash fictício para igualar o tempo de resposta quando o e-mail não existe (evita enumeração de usuários). */
export const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

export async function createSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(authSecret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Lê o usuário da sessão, revalidando no banco (desativação vale imediatamente). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  try {
    ({ payload: { sub } } = await jwtVerify(token, authSecret(), { algorithms: ["HS256"] }));
  } catch {
    return null;
  }
  if (!sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: sub },
    include: { psychologist: true },
  });
  if (!user || !user.active || user.deletedAt) return null;
  if (user.role === "PSYCHOLOGIST" && (!user.psychologist || !user.psychologist.active || user.psychologist.deletedAt)) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    psychologistId: user.psychologist?.id ?? null,
    canViewOthers: user.psychologist?.canViewOthers ?? false,
  };
});

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/painel?negado=1");
  return user;
}

/** Para Server Actions: lança em vez de redirecionar. */
export async function requireUserForAction(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Sessão expirada. Entre novamente.");
  if (roles && !roles.includes(user.role)) throw new ActionError("Você não tem permissão para esta ação.");
  return user;
}

