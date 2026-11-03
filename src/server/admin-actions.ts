"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActionError, hashPassword, requireUserForAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, bool, str, type ActionState } from "@/lib/action";
import { emailSchema, idSchema, nameSchema, passwordSchema } from "@/lib/validation";

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------------------------------------------------------- Segmentos */

const segmentSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome").max(80),
  description: z.string().trim().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

export async function createSegmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const d = segmentSchema.parse({ name: str(fd, "name"), description: str(fd, "description"), sortOrder: str(fd, "sortOrder") || 0 });
    const slug = slugify(d.name);
    if (await prisma.schoolSegment.findUnique({ where: { slug } })) throw new ActionError("Já existe um segmento com este nome.");
    const seg = await prisma.schoolSegment.create({ data: { ...d, slug } });
    await audit({ userId: me.id, action: "SEGMENT_CREATED", entityType: "SchoolSegment", entityId: seg.id, details: { name: seg.name } });
    revalidatePath("/painel/segmentos");
    return { ok: true, message: "Segmento criado." };
  });
}

export async function updateSegmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const id = idSchema.parse(str(fd, "id"));
    const d = segmentSchema.parse({ name: str(fd, "name"), description: str(fd, "description"), sortOrder: str(fd, "sortOrder") || 0 });
    const active = bool(fd, "active");
    if (!active) {
      const future = await prisma.appointment.count({ where: { segmentId: id, status: "CONFIRMED", startsAt: { gt: new Date() } } });
      if (future) throw new ActionError(`Há ${future} agendamento(s) futuro(s) neste segmento. Cancele ou remarque antes de desativar.`);
    }
    await prisma.schoolSegment.update({ where: { id }, data: { ...d, active } });
    await audit({ userId: me.id, action: "SEGMENT_UPDATED", entityType: "SchoolSegment", entityId: id, details: { ...d, active } });
    revalidatePath("/painel/segmentos");
    return { ok: true, message: "Segmento atualizado." };
  });
}

/** Define quais psicólogas atendem o segmento (sem mexer em código). */
export async function setSegmentPsychologistsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const segmentId = idSchema.parse(str(fd, "segmentId"));
    const ids = fd.getAll("psychologistIds").map(String);
    const valid = await prisma.psychologist.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
    const keep = new Set(valid.map((p) => p.id));

    // Não remover psicóloga que ainda tem agendamentos futuros neste segmento.
    const removing = await prisma.psychologistSegment.findMany({
      where: { segmentId, psychologistId: { notIn: [...keep] } },
      include: { psychologist: true },
    });
    for (const r of removing) {
      const future = await prisma.appointment.count({
        where: { segmentId, psychologistId: r.psychologistId, status: "CONFIRMED", startsAt: { gt: new Date() } },
      });
      if (future) throw new ActionError(`${r.psychologist.name} possui ${future} agendamento(s) futuro(s) neste segmento. Remarque antes de removê-la.`);
    }
    await prisma.$transaction([
      prisma.psychologistSegment.deleteMany({ where: { segmentId, psychologistId: { notIn: [...keep] } } }),
      prisma.psychologistSegment.createMany({ data: [...keep].map((psychologistId) => ({ psychologistId, segmentId })), skipDuplicates: true }),
    ]);
    await audit({ userId: me.id, action: "SEGMENT_PSYCHOLOGISTS_SET", entityType: "SchoolSegment", entityId: segmentId, details: { psychologistIds: [...keep] } });
    revalidatePath("/painel/segmentos");
    revalidatePath("/painel/psicologas");
    return { ok: true, message: "Psicólogas do segmento atualizadas." };
  });
}

/* ---------------------------------------------------------------- Psicólogas */

const psyBase = z.object({
  name: nameSchema("nome da psicóloga"),
  email: emailSchema,
  phone: z.string().trim().max(30).optional(),
});

export async function createPsychologistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const d = psyBase.parse({ name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone") });
    const password = passwordSchema.parse(String(fd.get("password") ?? ""));
    if (await prisma.user.findUnique({ where: { email: d.email } })) throw new ActionError("Já existe um usuário com este e-mail.");
    const segmentIds = fd.getAll("segmentIds").map(String);

    const psy = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: d.name, email: d.email, role: "PSYCHOLOGIST", passwordHash: await hashPassword(password) },
      });
      return tx.psychologist.create({
        data: {
          userId: user.id,
          name: d.name,
          email: d.email,
          phone: d.phone || null,
          canViewOthers: bool(fd, "canViewOthers"),
          segments: { create: segmentIds.map((segmentId) => ({ segmentId })) },
        },
      });
    });
    await audit({ userId: me.id, action: "PSYCHOLOGIST_CREATED", entityType: "Psychologist", entityId: psy.id, details: { email: d.email } });
    revalidatePath("/painel/psicologas");
    return { ok: true, message: "Psicóloga cadastrada. Informe a senha inicial a ela por um canal seguro." };
  });
}

export async function updatePsychologistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const id = idSchema.parse(str(fd, "id"));
    const d = psyBase.parse({ name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone") });
    const active = bool(fd, "active");
    const psy = await prisma.psychologist.findUniqueOrThrow({ where: { id } });
    const clash = await prisma.user.findFirst({ where: { email: d.email, NOT: { id: psy.userId } } });
    if (clash) throw new ActionError("Este e-mail já pertence a outro usuário.");

    if (!active && psy.active) {
      const future = await prisma.appointment.count({ where: { psychologistId: id, status: "CONFIRMED", startsAt: { gt: new Date() } } });
      if (future) throw new ActionError(`Há ${future} agendamento(s) futuro(s) com esta psicóloga. Remarque ou cancele antes de desativar.`);
    }
    const segmentIds = fd.getAll("segmentIds").map(String);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: psy.userId }, data: { name: d.name, email: d.email, active } });
      await tx.psychologist.update({
        where: { id },
        data: { name: d.name, email: d.email, phone: d.phone || null, active, canViewOthers: bool(fd, "canViewOthers") },
      });
      await tx.psychologistSegment.deleteMany({ where: { psychologistId: id, segmentId: { notIn: segmentIds } } });
      await tx.psychologistSegment.createMany({ data: segmentIds.map((segmentId) => ({ psychologistId: id, segmentId })), skipDuplicates: true });
      if (!active) {
        // Horários livres de quem foi desativada deixam de ser ofertados.
        await tx.availabilitySlot.updateMany({ where: { psychologistId: id, status: "AVAILABLE", startsAt: { gt: new Date() } }, data: { status: "BLOCKED", blockReason: "Psicóloga desativada" } });
      }
    });
    await audit({ userId: me.id, action: "PSYCHOLOGIST_UPDATED", entityType: "Psychologist", entityId: id, details: { active, segmentIds } });
    revalidatePath("/painel/psicologas");
    return { ok: true, message: "Cadastro atualizado." };
  });
}

/* ---------------------------------------------------------------- Usuários */

export async function createStaffUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const role = z.enum(["ADMIN", "COORDINATION"]).parse(str(fd, "role"));
    const name = nameSchema("nome").parse(str(fd, "name"));
    const email = emailSchema.parse(str(fd, "email"));
    const password = passwordSchema.parse(String(fd.get("password") ?? ""));
    if (await prisma.user.findUnique({ where: { email } })) throw new ActionError("Já existe um usuário com este e-mail.");
    const user = await prisma.user.create({ data: { name, email, role, passwordHash: await hashPassword(password) } });
    await audit({ userId: me.id, action: "USER_CREATED", entityType: "User", entityId: user.id, details: { role, email } });
    revalidatePath("/painel/usuarios");
    return { ok: true, message: "Usuário criado." };
  });
}

export async function setUserActiveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const id = idSchema.parse(str(fd, "id"));
    const active = str(fd, "active") === "true";
    if (id === me.id && !active) throw new ActionError("Você não pode desativar o próprio acesso.");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    if (user.role === "PSYCHOLOGIST") throw new ActionError("Gerencie psicólogas na página Psicólogas.");
    if (user.role === "ADMIN" && !active && (await prisma.user.count({ where: { role: "ADMIN", active: true } })) <= 1) {
      throw new ActionError("É necessário manter ao menos um administrador ativo.");
    }
    await prisma.user.update({ where: { id }, data: { active } });
    await audit({ userId: me.id, action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entityType: "User", entityId: id });
    revalidatePath("/painel/usuarios");
    return { ok: true };
  });
}

export async function resetUserPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const id = idSchema.parse(str(fd, "id"));
    const password = passwordSchema.parse(String(fd.get("password") ?? ""));
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    // zera tentativas de login para liberar o acesso imediatamente
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    await prisma.loginAttempt.deleteMany({ where: { key: `login:email:${u.email}` } });
    await audit({ userId: me.id, action: "PASSWORD_RESET_BY_ADMIN", entityType: "User", entityId: id });
    return { ok: true, message: "Senha redefinida. Compartilhe-a por um canal seguro." };
  });
}
