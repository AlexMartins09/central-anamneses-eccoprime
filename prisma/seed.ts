/**
 * Seed idempotente.
 *  - Cria os 3 segmentos iniciais e as configurações padrão.
 *  - Cria o administrador inicial a partir de SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *    (se a senha não for informada, gera uma aleatória e imprime UMA vez).
 *  - SEED_DEMO=true cria psicólogas e horários de demonstração (somente desenvolvimento).
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { expandRule, persistSlots } from "../src/lib/slots";
import { addDaysKey, todayKey } from "../src/lib/time";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* sem .env: usa o ambiente */
}

const prisma = new PrismaClient();

const SEGMENTS = [
  { slug: "educacao-infantil", name: "Educação Infantil", description: "Maternal e Pré-escola", sortOrder: 1 },
  { slug: "fundamental-1", name: "Ensino Fundamental 1", description: "1º ao 5º ano", sortOrder: 2 },
  { slug: "fundamental-2", name: "Ensino Fundamental 2 e Médio", description: "6º ao 9º ano e 1ª à 3ª série do Ensino Médio", sortOrder: 3 },
];

async function main() {
  for (const s of SEGMENTS) {
    await prisma.schoolSegment.upsert({ where: { slug: s.slug }, create: s, update: {} });
  }
  await prisma.systemSetting.upsert({ where: { key: "app" }, create: { key: "app", value: DEFAULT_SETTINGS }, update: {} });

  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@eccoprime.com.br").toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const generated = !process.env.SEED_ADMIN_PASSWORD;
    const password = process.env.SEED_ADMIN_PASSWORD ?? `${randomBytes(9).toString("base64url")}aA1`;
    await prisma.user.create({
      data: { name: process.env.SEED_ADMIN_NAME ?? "Administrador", email, role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) },
    });
    console.log(`\n✔ Administrador criado: ${email}`);
    if (generated) console.log(`  Senha gerada (anote agora, não será exibida novamente): ${password}\n`);
  } else {
    console.log(`Administrador ${email} já existe — mantido.`);
  }

  if (process.env.SEED_DEMO === "true") await demo();
  console.log("Seed concluído.");
}

async function demo() {
  const password = process.env.SEED_DEMO_PASSWORD ?? "Demo12345678";
  const hash = await bcrypt.hash(password, 10);
  const segments = await prisma.schoolSegment.findMany({ orderBy: { sortOrder: "asc" } });
  const people = [
    { name: "Ana Souza", email: "ana.demo@eccoprime.test", segs: [0, 1] },
    { name: "Bruna Lima", email: "bruna.demo@eccoprime.test", segs: [2] },
  ];
  for (const p of people) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      create: { name: p.name, email: p.email, role: "PSYCHOLOGIST", passwordHash: hash },
      update: {},
    });
    const psy = await prisma.psychologist.upsert({
      where: { userId: user.id },
      create: { userId: user.id, name: p.name, email: p.email },
      update: {},
    });
    for (const i of p.segs) {
      await prisma.psychologistSegment.upsert({
        where: { psychologistId_segmentId: { psychologistId: psy.id, segmentId: segments[i].id } },
        create: { psychologistId: psy.id, segmentId: segments[i].id },
        update: {},
      });
    }
    const seg = segments[p.segs[0]];
    const start = addDaysKey(todayKey(), 2);
    const rule = {
      startDate: start, endDate: addDaysKey(start, 20), weekdays: [1, 3, 5],
      startMinute: 8 * 60, endMinute: 11 * 60, durationMinutes: 50, gapMinutes: 10,
    };
    const r = await prisma.availabilityRule.create({
      data: { psychologistId: psy.id, segmentId: seg.id, ...rule, startDate: new Date(rule.startDate), endDate: new Date(rule.endDate) },
    });
    await prisma.$transaction((tx) =>
      persistSlots(tx, { psychologistId: psy.id, segmentId: seg.id, ruleId: r.id, times: expandRule(rule) }),
    );
  }
  await prisma.user.upsert({
    where: { email: "atendimento.demo@eccoprime.test" },
    create: { name: "Atendimento Demo", email: "atendimento.demo@eccoprime.test", role: "COORDINATION", passwordHash: hash },
    update: {},
  });
  console.log(`✔ Dados de demonstração criados (senha das contas demo: ${password}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
