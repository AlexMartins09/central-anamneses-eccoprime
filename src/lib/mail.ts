import nodemailer, { type Transporter } from "nodemailer";
import { smtpConfig } from "./env";

let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return smtpConfig().configured;
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const c = smtpConfig();
  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!mailConfigured()) throw new Error("SMTP não configurado (defina SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM).");
  await getTransporter().sendMail({
    from: smtpConfig().from,
    to,
    subject,
    html,
    text: html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  });
}
