import { z } from "zod";
import { prisma } from "./db";

export const settingsSchema = z.object({
  // Identidade visual (configurável pelo admin)
  brandName: z.string().min(1).max(80),
  brandTagline: z.string().max(160),
  logoUrl: z.string().max(500).refine((v) => v === "" || /^(https:\/\/|\/)/.test(v), "Use um endereço https:// ou caminho relativo"),
  /** HSL "H S% L%" */
  colorPrimary: z.string().regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/),
  colorAccent: z.string().regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/),
  welcomeText: z.string().max(600),

  // Regras de agendamento
  defaultDurationMinutes: z.number().int().min(10).max(240),
  minLeadHours: z.number().int().min(0).max(24 * 30),
  maxDaysAhead: z.number().int().min(1).max(365),

  // Notificações
  reminderHoursBefore: z.number().int().min(1).max(24 * 14),
  remindersEnabled: z.boolean(),
  teamEmails: z.array(z.string().email()).max(20),
  attendanceInstructions: z.string().max(2000),
  schoolContactPhone: z.string().max(40),

  // Google
  teamCalendarId: z.string().max(300),

  // Permissões
  coordinationCanCancel: z.boolean(),

  // LGPD
  retentionMonths: z.number().int().min(6).max(120),
  privacyContactEmail: z.string().max(200),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "Eccoprime",
  brandTagline: "Escola Eccoprime",
  logoUrl: "",
  colorPrimary: "215 70% 28%",
  colorAccent: "172 60% 36%",
  welcomeText:
    "Seja bem-vindo(a) à Central de Agendamento de Anamneses da Eccoprime! Selecione o segmento escolar do seu filho, escolha uma data e horário disponíveis e conclua seu agendamento.",
  defaultDurationMinutes: 50,
  minLeadHours: 12,
  maxDaysAhead: 90,
  reminderHoursBefore: 24,
  remindersEnabled: true,
  teamEmails: [],
  attendanceInstructions:
    "Compareça com 10 minutos de antecedência, na recepção da escola. Caso precise remarcar ou cancelar, entre em contato com a escola o quanto antes.",
  schoolContactPhone: "",
  teamCalendarId: "primary",
  coordinationCanCancel: true,
  retentionMonths: 24,
  privacyContactEmail: "",
};

const KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  const parsed = settingsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next },
    update: { value: next },
  });
  return next;
}

/** Versão da política de privacidade aceita pela família. Incrementar ao alterar o texto. */
export const PRIVACY_VERSION = "2026-11-01";
