import { prisma } from "../src/lib/db";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Notification","GoogleCalendarEvent","GoogleCalendarConnection","Appointment","AvailabilitySlot","AvailabilityRule","PsychologistSegment","Psychologist","User","SchoolSegment","AuditLog","SystemSetting","LoginAttempt" RESTART IDENTITY CASCADE`,
  );
}

export async function makeWorld(opts: { psychologists?: number } = {}) {
  const segment = await prisma.schoolSegment.create({ data: { slug: "ei", name: "Educação Infantil" } });
  const other = await prisma.schoolSegment.create({ data: { slug: "em", name: "Ensino Médio" } });
  const psychologists = [];
  for (let i = 0; i < (opts.psychologists ?? 1); i++) {
    const user = await prisma.user.create({
      data: { name: `Psi ${i}`, email: `psi${i}@t.com`, passwordHash: "x", role: "PSYCHOLOGIST" },
    });
    const psy = await prisma.psychologist.create({
      data: { userId: user.id, name: `Psi ${i}`, email: `psi${i}@t.com`, segments: { create: { segmentId: segment.id } } },
    });
    psychologists.push(psy);
  }
  return { segment, other, psychologists };
}

/** Horário livre no futuro (por padrão daqui a `hours` horas). */
export async function makeSlot(psychologistId: string, segmentId: string, hours = 72, minutes = 50) {
  const startsAt = new Date(Date.now() + hours * 3600_000);
  startsAt.setSeconds(0, 0);
  return prisma.availabilitySlot.create({
    data: { psychologistId, segmentId, startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) },
  });
}

export const family = (n: number) => ({
  guardianName: `Responsável ${n}`,
  studentName: `Aluno ${n}`,
  phone: "(81) 99999-0000",
  email: `familia${n}@teste.com`,
});
