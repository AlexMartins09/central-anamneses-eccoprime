"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActionError, requireUserForAction, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, type ActionState } from "@/lib/action";
import { assertCanManageAvailability } from "@/lib/rbac";
import { expandRule, persistSlots, type RuleInput } from "@/lib/slots";
import { addDaysKey, endOfLocalDay, hhmmToMinutes, startOfLocalDay, todayKey, weekdayOf, WEEKDAY_LABELS } from "@/lib/time";
import { dateKeySchema, idSchema } from "@/lib/validation";

const MAX_DAYS = 400;
const MAX_SLOTS = 6000;

/** Psicóloga: sempre a própria. Administrador: a escolhida no formulário. */
async function resolvePsychologist(me: SessionUser, fd: FormData): Promise<string> {
  const id = me.role === "PSYCHOLOGIST" ? me.psychologistId : str(fd, "psychologistId");
  if (!id) throw new ActionError("Psicóloga não identificada.");
  assertCanManageAvailability(me, id);
  const psy = await prisma.psychologist.findFirst({ where: { id, active: true, deletedAt: null }, include: { segments: true } });
  if (!psy) throw new ActionError("Psicóloga não encontrada ou inativa.");
  return psy.id;
}

async function assertSegmentOfPsychologist(psychologistId: string, segmentId: string) {
  const link = await prisma.psychologistSegment.findUnique({
    where: { psychologistId_segmentId: { psychologistId, segmentId } },
    include: { segment: true },
  });
  if (!link || !link.segment.active) throw new ActionError("Esta psicóloga não atende o segmento selecionado.");
}

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");

const commonSchema = z.object({
  segmentId: idSchema,
  durationMinutes: z.coerce.number().int().min(10, "Duração mínima: 10 min").max(240, "Duração máxima: 240 min"),
  gapMinutes: z.coerce.number().int().min(0).max(120),
});

async function createRules(me: SessionUser, psychologistId: string, segmentId: string, rules: RuleInput[]) {
  const total = rules.reduce((n, r) => n + expandRule(r).length, 0);
  if (total === 0) throw new ActionError("Nenhum horário seria gerado com estas configurações.");
  if (total > MAX_SLOTS) throw new ActionError(`Muitos horários de uma vez (${total}). Reduza o período.`);

  const result = { created: 0, skippedPast: 0, skippedConflict: 0 };
  await prisma.$transaction(
    async (tx) => {
      for (const r of rules) {
        const rule = await tx.availabilityRule.create({
          data: {
            psychologistId, segmentId,
            startDate: new Date(r.startDate), endDate: new Date(r.endDate),
            weekdays: r.weekdays, startMinute: r.startMinute, endMinute: r.endMinute,
            durationMinutes: r.durationMinutes, gapMinutes: r.gapMinutes,
          },
        });
        const g = await persistSlots(tx, { psychologistId, segmentId, ruleId: rule.id, times: expandRule(r) });
        result.created += g.created;
        result.skippedPast += g.skippedPast;
        result.skippedConflict += g.skippedConflict;
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await audit({ userId: me.id, action: "AVAILABILITY_RELEASED", entityType: "Psychologist", entityId: psychologistId, details: { segmentId, ...result } });
  revalidatePath("/painel/disponibilidade");
  revalidatePath("/painel/agenda");
  return result;
}

function summary(r: { created: number; skippedPast: number; skippedConflict: number }): ActionState {
  const extra = [r.skippedConflict && `${r.skippedConflict} já existiam/conflitavam`, r.skippedPast && `${r.skippedPast} no passado`].filter(Boolean).join("; ");
  return { ok: true, message: `${r.created} horário(s) liberado(s)${extra ? ` (${extra} — ignorados)` : ""}.` };
}

/** LIBERAR DISPONIBILIDADE: período + dias da semana (cada um com a própria janela) + duração + intervalo. */
export async function releaseAvailabilityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const psychologistId = await resolvePsychologist(me, fd);
    const common = commonSchema.parse({ segmentId: str(fd, "segmentId"), durationMinutes: str(fd, "durationMinutes"), gapMinutes: str(fd, "gapMinutes") || 0 });
    await assertSegmentOfPsychologist(psychologistId, common.segmentId);

    const startDate = dateKeySchema.parse(str(fd, "startDate"));
    const endDate = dateKeySchema.parse(str(fd, "endDate"));
    if (endDate < startDate) throw new ActionError("A data final deve ser igual ou posterior à data inicial.");
    if (endDate < todayKey()) throw new ActionError("O período já terminou.");
    if (addDaysKey(startDate, MAX_DAYS) < endDate) throw new ActionError(`O período máximo é de ${MAX_DAYS} dias.`);

    const rules: RuleInput[] = [];
    for (let d = 0; d < 7; d++) {
      if (fd.get(`wd${d}`) !== "on") continue;
      const start = timeSchema.parse(str(fd, `wd${d}_start`));
      const end = timeSchema.parse(str(fd, `wd${d}_end`));
      const sm = hhmmToMinutes(start);
      const em = hhmmToMinutes(end);
      if (em <= sm) throw new ActionError(`${WEEKDAY_LABELS[d]}: o término deve ser depois do início.`);
      if (em - sm < common.durationMinutes) throw new ActionError(`${WEEKDAY_LABELS[d]}: a janela é menor que a duração do atendimento.`);
      rules.push({ startDate, endDate, weekdays: [d], startMinute: sm, endMinute: em, durationMinutes: common.durationMinutes, gapMinutes: common.gapMinutes });
    }
    if (!rules.length) throw new ActionError("Selecione ao menos um dia da semana.");
    return summary(await createRules(me, psychologistId, common.segmentId, rules));
  });
}

/** Liberar uma data específica (sem recorrência). */
export async function releaseSpecificDateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const psychologistId = await resolvePsychologist(me, fd);
    const common = commonSchema.parse({ segmentId: str(fd, "segmentId"), durationMinutes: str(fd, "durationMinutes"), gapMinutes: str(fd, "gapMinutes") || 0 });
    await assertSegmentOfPsychologist(psychologistId, common.segmentId);
    const date = dateKeySchema.parse(str(fd, "date"));
    const sm = hhmmToMinutes(timeSchema.parse(str(fd, "start")));
    const em = hhmmToMinutes(timeSchema.parse(str(fd, "end")));
    if (em - sm < common.durationMinutes) throw new ActionError("A janela é menor que a duração do atendimento.");
    return summary(
      await createRules(me, psychologistId, common.segmentId, [
        { startDate: date, endDate: date, weekdays: [weekdayOf(date)], startMinute: sm, endMinute: em, durationMinutes: common.durationMinutes, gapMinutes: common.gapMinutes },
      ]),
    );
  });
}

/** Bloqueia todos os horários LIVRES de um dia. Horários já agendados não são tocados. */
export async function blockDayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const psychologistId = await resolvePsychologist(me, fd);
    const date = dateKeySchema.parse(str(fd, "date"));
    const reason = str(fd, "reason").slice(0, 120) || "Dia bloqueado";
    const where = { psychologistId, startsAt: { gte: startOfLocalDay(date), lt: endOfLocalDay(date) } };
    const blocked = await prisma.availabilitySlot.updateMany({ where: { ...where, status: "AVAILABLE" }, data: { status: "BLOCKED", blockReason: reason } });
    const booked = await prisma.availabilitySlot.count({ where: { ...where, status: "BOOKED" } });
    await audit({ userId: me.id, action: "DAY_BLOCKED", entityType: "Psychologist", entityId: psychologistId, details: { date, blocked: blocked.count, booked } });
    revalidatePath("/painel/disponibilidade");
    revalidatePath("/painel/agenda");
    return {
      ok: true,
      message:
        `${blocked.count} horário(s) bloqueado(s).` +
        (booked ? ` Atenção: ${booked} horário(s) deste dia já têm agendamento e foram mantidos — cancele ou remarque em "Agendamentos".` : ""),
    };
  });
}

export async function toggleSlotBlockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: idSchema.parse(str(fd, "slotId")) } });
    assertCanManageAvailability(me, slot.psychologistId);
    if (slot.status === "BOOKED") throw new ActionError("Este horário tem agendamento. Cancele ou remarque o atendimento primeiro.");
    const next = slot.status === "BLOCKED" ? "AVAILABLE" : "BLOCKED";
    if (next === "AVAILABLE" && slot.startsAt <= new Date()) throw new ActionError("Não é possível liberar um horário no passado.");
    await prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: next, blockReason: next === "BLOCKED" ? "Bloqueado manualmente" : null } });
    await audit({ userId: me.id, action: next === "BLOCKED" ? "SLOT_BLOCKED" : "SLOT_UNBLOCKED", entityType: "AvailabilitySlot", entityId: slot.id });
    revalidatePath("/painel/disponibilidade");
    return { ok: true };
  });
}

/** Exclui um horário. Com agendamento confirmado: recusa e orienta o fluxo de cancelamento/remarcação. */
export async function deleteSlotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: idSchema.parse(str(fd, "slotId")) },
      include: { _count: { select: { appointments: true } } },
    });
    assertCanManageAvailability(me, slot.psychologistId);
    if (slot.status === "BOOKED") {
      throw new ActionError('Existe um agendamento confirmado neste horário. Use "Agendamentos" para cancelar ou remarcar antes de excluir.');
    }
    if (slot._count.appointments > 0) {
      // histórico preserva integridade: apenas retira da oferta
      await prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: "BLOCKED", blockReason: "Removido" } });
    } else {
      await prisma.availabilitySlot.delete({ where: { id: slot.id } });
    }
    await audit({ userId: me.id, action: "SLOT_DELETED", entityType: "AvailabilitySlot", entityId: slot.id });
    revalidatePath("/painel/disponibilidade");
    return { ok: true };
  });
}

/** Encerra uma regra recorrente: remove os horários futuros não agendados; os agendados são preservados. */
export async function deleteRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const rule = await prisma.availabilityRule.findUniqueOrThrow({ where: { id: idSchema.parse(str(fd, "ruleId")) } });
    assertCanManageAvailability(me, rule.psychologistId);
    const now = new Date();
    const kept = await prisma.availabilitySlot.count({ where: { ruleId: rule.id, status: "BOOKED", startsAt: { gt: now } } });
    const removed = await prisma.$transaction(async (tx) => {
      const del = await tx.availabilitySlot.deleteMany({ where: { ruleId: rule.id, status: { in: ["AVAILABLE", "BLOCKED"] }, startsAt: { gt: now }, appointments: { none: {} } } });
      await tx.availabilitySlot.updateMany({ where: { ruleId: rule.id, status: { in: ["AVAILABLE", "BLOCKED"] }, startsAt: { gt: now } }, data: { status: "BLOCKED", blockReason: "Regra removida" } });
      await tx.availabilityRule.update({ where: { id: rule.id }, data: { active: false } });
      return del.count;
    });
    await audit({ userId: me.id, action: "RULE_REMOVED", entityType: "AvailabilityRule", entityId: rule.id, details: { removed, kept } });
    revalidatePath("/painel/disponibilidade");
    return {
      ok: true,
      message: `${removed} horário(s) livre(s) removido(s).` + (kept ? ` ${kept} horário(s) com agendamento foram mantidos — cancele ou remarque em "Agendamentos".` : ""),
    };
  });
}
