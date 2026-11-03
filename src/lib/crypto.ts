import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { encryptionKey } from "./env";

/** AES-256-GCM. Formato: iv:tag:ciphertext (base64). Usado para tokens do Google. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(":").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Código legível do agendamento, ex.: ANA-7K3F9Q2M */
export function generateAppointmentCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += CROCKFORD[b % 32];
  return `ANA-${out}`;
}

/**
 * ID de evento do Google: apenas [a-v0-9], 5–1024 caracteres. Determinístico por agendamento+destino,
 * assim uma nova tentativa nunca duplica o evento (o Google responde 409 e atualizamos).
 */
export function googleEventId(appointmentId: string, target: string): string {
  return createHash("sha256").update(`${appointmentId}:${target}`).digest("hex").slice(0, 40);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
