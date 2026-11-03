import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Simula somente a rede/OAuth do Google; toda a lógica de sincronização e o banco são reais.
const oauth = vi.hoisted(() => ({ tokenError: null as null | Error }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials() {}
    async getAccessToken() {
      if (oauth.tokenError) throw oauth.tokenError;
      return { token: "access-token" };
    }
    generateAuthUrl() {
      return "https://accounts.google.com/o/oauth2/v2/auth?mock=1";
    }
    async revokeToken() {}
  },
}));

import { prisma } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";
import { bookSlot, cancelAppointment, rescheduleAppointment } from "../src/lib/booking";
import { processCalendarSync, requeueAfterConnect, syncAppointmentNow } from "../src/lib/calendar-sync";
import { family, makeSlot, makeWorld, resetDb } from "./helpers";

type Call = { method: string; url: string; body?: any };
let calls: Call[] = [];
let handler: (c: Call) => { status: number; json?: unknown } | Error = () => ({ status: 200, json: {} });

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});

beforeEach(async () => {
  await resetDb();
  calls = [];
  handler = () => ({ status: 200, json: {} });
  oauth.tokenError = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const r = handler(c);
      if (r instanceof Error) throw r;
      return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await prisma.$disconnect();
});

async function setup() {
  const world = await makeWorld({ psychologists: 2 });
  for (const p of world.psychologists) {
    await prisma.googleCalendarConnection.create({
      data: { kind: "PSYCHOLOGIST", psychologistId: p.id, googleEmail: `${p.name}@g.com`, refreshTokenEnc: encrypt("r"), calendarId: `cal-${p.name.replace(" ", "")}` },
    });
  }
  await prisma.googleCalendarConnection.create({
    data: { kind: "TEAM", googleEmail: "equipe@g.com", refreshTokenEnc: encrypt("r"), calendarId: "equipe-cal" },
  });
  return world;
}

const book = async (w: Awaited<ReturnType<typeof setup>>, hours = 100, n = 1, psy = 0) => {
  const slot = await makeSlot(w.psychologists[psy].id, w.segment.id, hours);
  return bookSlot({ slotId: slot.id, segmentId: w.segment.id, ...family(n) });
};

describe("sincronização com o Google Calendar", () => {
  it("cria o evento na agenda da psicóloga E na agenda geral, com ID determinístico e só dados administrativos", async () => {
    const w = await setup();
    const appt = await book(w);
    await syncAppointmentNow(appt.id);

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map((c) => decodeURIComponent(c.url)).sort()).toEqual([
      expect.stringContaining("/calendars/cal-Psi0/events"),
      expect.stringContaining("/calendars/equipe-cal/events"),
    ]);
    const body = posts[0].body;
    expect(body.summary).toBe("Anamnese – Educação Infantil");
    expect(body.id).toMatch(/^[a-v0-9]{40}$/);
    expect(body.start.timeZone).toBe("America/Recife");
    expect(body.attendees).toBeUndefined(); // não convida a família
    expect(body.description).toContain(appt.code);
    expect(body.description).not.toContain(appt.email); // e-mail da família não vai para a agenda

    const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "SYNCED" && e.syncedAt && e.calendarId)).toBe(true);
  });

  it("falha temporária (500 e sem rede): agendamento permanece válido, falha é registrada e a nova tentativa funciona", async () => {
    const w = await setup();
    const appt = await book(w);

    handler = () => ({ status: 500, json: { error: "backend" } });
    await syncAppointmentNow(appt.id);
    let events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "FAILED" && e.attempts === 1 && e.nextAttemptAt && e.lastError?.includes("500"))).toBe(true);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("CONFIRMED");

    // antes do backoff: o worker não repete
    expect(await processCalendarSync(10)).toMatchObject({ synced: 0 });

    // sem conexão de rede
    handler = () => new Error("ECONNRESET");
    await processCalendarSync(10, new Date(Date.now() + 3 * 3600_000));
    events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "FAILED" && e.attempts === 2 && /conexão/i.test(e.lastError ?? ""))).toBe(true);

    // Google volta: o worker conclui
    handler = () => ({ status: 200, json: {} });
    const r = await processCalendarSync(10, new Date(Date.now() + 10 * 3600_000));
    expect(r.synced).toBe(2);
    events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "SYNCED")).toBe(true);
  });

  it("não duplica: se o evento já existe (409), atualiza com PUT no mesmo ID", async () => {
    const w = await setup();
    const appt = await book(w);
    handler = (c) => (c.method === "POST" ? { status: 409, json: { error: "exists" } } : { status: 200, json: {} });
    await syncAppointmentNow(appt.id);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2);
    const ids = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(ids.every((e) => e.status === "SYNCED")).toBe(true);
    for (const put of calls.filter((c) => c.method === "PUT")) expect(ids.some((e) => put.url.endsWith(`/events/${e.googleEventId}`))).toBe(true);
  });

  it("cancelar remove os eventos do Google (404 na remoção conta como sucesso)", async () => {
    const w = await setup();
    const appt = await book(w);
    await syncAppointmentNow(appt.id);
    calls = [];
    await cancelAppointment({ appointmentId: appt.id });
    handler = (c) => (c.method === "DELETE" ? { status: 404, json: {} } : { status: 200, json: {} });
    await syncAppointmentNow(appt.id);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
    const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "CANCELLED")).toBe(true);
  });

  it("remarcar para outra psicóloga: remove da agenda antiga e cria na nova", async () => {
    const w = await setup();
    const appt = await book(w, 100, 1, 0);
    await syncAppointmentNow(appt.id);
    calls = [];
    const target = await makeSlot(w.psychologists[1].id, w.segment.id, 150);
    await rescheduleAppointment({ appointmentId: appt.id, newSlotId: target.id });
    await syncAppointmentNow(appt.id);

    const urls = calls.map((c) => `${c.method} ${decodeURIComponent(c.url)}`);
    expect(urls.some((u) => u.startsWith("DELETE") && u.includes("cal-Psi0"))).toBe(true);
    expect(urls.some((u) => /^(PUT|POST)/.test(u) && u.includes("cal-Psi1"))).toBe(true);
    const psyEvent = await prisma.googleCalendarEvent.findFirstOrThrow({ where: { appointmentId: appt.id, target: "PSYCHOLOGIST" } });
    expect(psyEvent).toMatchObject({ status: "SYNCED", psychologistId: w.psychologists[1].id });
  });

  it("sem conta conectada: fica 'aguardando conexão' e sincroniza assim que a psicóloga conecta", async () => {
    const w = await makeWorld();
    const slot = await makeSlot(w.psychologists[0].id, w.segment.id);
    const appt = await bookSlot({ slotId: slot.id, segmentId: w.segment.id, ...family(1) });
    await syncAppointmentNow(appt.id);
    expect(calls).toHaveLength(0);
    let events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "SKIPPED")).toBe(true);

    await prisma.googleCalendarConnection.create({
      data: { kind: "PSYCHOLOGIST", psychologistId: w.psychologists[0].id, googleEmail: "x@g.com", refreshTokenEnc: encrypt("r") },
    });
    await requeueAfterConnect("PSYCHOLOGIST", w.psychologists[0].id);
    await processCalendarSync(10);
    events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.find((e) => e.target === "PSYCHOLOGIST")!.status).toBe("SYNCED");
    expect(events.find((e) => e.target === "TEAM")!.status).toBe("SKIPPED"); // equipe ainda não conectada
  });

  it("acesso revogado (invalid_grant): desativa a conexão e pede reconexão, sem insistir", async () => {
    const w = await setup();
    const appt = await book(w);
    oauth.tokenError = new Error("invalid_grant: Token has been expired or revoked.");
    await syncAppointmentNow(appt.id);
    const used = await prisma.googleCalendarConnection.findMany({ where: { OR: [{ kind: "TEAM" }, { psychologistId: w.psychologists[0].id }] } });
    expect(used).toHaveLength(2);
    expect(used.every((c) => !c.active && /reconect/i.test(c.lastError ?? ""))).toBe(true);
    const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "SKIPPED")).toBe(true);
  });
});
