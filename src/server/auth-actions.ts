"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DUMMY_HASH, createSession, destroySession, hashPassword, requireUserForAction, verifyPassword, getCurrentUser } from "@/lib/auth";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { run, str, type ActionState } from "@/lib/action";
import { ActionError } from "@/lib/auth";
import { passwordSchema } from "@/lib/validation";

const WINDOW = 15 * 60_000;
const loginSchema = z.object({ email: z.string().email("E-mail inválido").max(200), password: z.string().min(1).max(200) });



export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email").toLowerCase(), password: String(fd.get("password") ?? "") });
  if (!parsed.success) return { ok: false, error: "Informe e-mail e senha válidos." };
  const { email, password } = parsed.data;

  const ip = (await clientIp()) ?? "unknown";
  const emailKey = `login:email:${email}`;
  const ipKey = `login:ip:${ip}`;
  if ((await isRateLimited(emailKey, 5, WINDOW, true)) || (await isRateLimited(ipKey, 20, WINDOW, true))) {
    return { ok: false, error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Sempre compara hash (mesmo sem usuário) para não revelar quais e-mails existem pelo tempo de resposta.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.active || user.deletedAt) {
    await Promise.all([recordAttempt(emailKey, false), recordAttempt(ipKey, false)]);
    return { ok: false, error: "E-mail ou senha incorretos." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id });
  redirect("/painel");
}

export async function logoutAction() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ userId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id });
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction();
    const current = String(fd.get("current") ?? "");
    const next = passwordSchema.parse(String(fd.get("next") ?? ""));
    if (next !== String(fd.get("confirm") ?? "")) throw new ActionError("A confirmação não confere com a nova senha.");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new ActionError("Senha atual incorreta.");
    await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next) } });
    await audit({ userId: me.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: me.id });
    return { ok: true, message: "Senha alterada com sucesso." };
  });
}
