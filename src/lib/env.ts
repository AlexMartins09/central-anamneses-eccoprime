import { createHash } from "node:crypto";

/** Acesso centralizado às variáveis de ambiente (nunca importar em componentes de cliente). */

export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function authSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres). Rode: npm run gen:secrets");
  }
  return new TextEncoder().encode(s);
}

export function encryptionKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length < 32) throw new Error("ENCRYPTION_KEY ausente ou curta (mínimo 32 caracteres). Rode: npm run gen:secrets");
  // Deriva 32 bytes estáveis para AES-256 a partir do segredo informado.
  return createHash("sha256").update(k).digest();
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${appUrl()}/api/google/callback`;
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) };
}

export function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? "Eccoprime <nao-responder@eccoprime.com.br>",
    configured: Boolean(host),
  };
}
