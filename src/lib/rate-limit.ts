import { headers } from "next/headers";
import { prisma } from "./db";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

/**
 * Limitador persistido no banco (funciona com múltiplas instâncias e reinícios).
 * Retorna true se o limite foi excedido.
 */
export async function isRateLimited(key: string, max: number, windowMs: number, onlyFailures = false): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.loginAttempt.count({
    where: { key, createdAt: { gte: since }, ...(onlyFailures ? { success: false } : {}) },
  });
  return count >= max;
}

export async function recordAttempt(key: string, success: boolean) {
  await prisma.loginAttempt.create({ data: { key, success } });
}

export async function purgeOldAttempts(olderThanMs = 24 * 3600 * 1000) {
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } } });
}
