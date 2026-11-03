import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { isRateLimited, purgeOldAttempts, recordAttempt } from "../src/lib/rate-limit";
import { canManageAppointment, visibleToUser, assertCanManageAvailability } from "../src/lib/rbac";
import { decrypt, encrypt, googleEventId } from "../src/lib/crypto";
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from "../src/lib/validation";
import type { SessionUser } from "../src/lib/auth";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const user = (role: SessionUser["role"], extra: Partial<SessionUser> = {}): SessionUser => ({
  id: "u1", name: "N", email: "n@x.com", role, psychologistId: role === "PSYCHOLOGIST" ? "psyA" : null, canViewOthers: false, ...extra,
});

describe("limitação de tentativas de login", () => {
  it("bloqueia após 5 falhas na janela e ignora sucessos", async () => {
    const key = "login:email:a@b.com";
    for (let i = 0; i < 4; i++) await recordAttempt(key, false);
    expect(await isRateLimited(key, 5, 15 * 60_000, true)).toBe(false);
    await recordAttempt(key, true); // sucesso não conta como falha
    expect(await isRateLimited(key, 5, 15 * 60_000, true)).toBe(false);
    await recordAttempt(key, false);
    expect(await isRateLimited(key, 5, 15 * 60_000, true)).toBe(true);
    expect(await isRateLimited("login:email:outro@b.com", 5, 15 * 60_000, true)).toBe(false);
  });

  it("tentativas antigas expiram e são removidas", async () => {
    await prisma.loginAttempt.create({ data: { key: "k", success: false, createdAt: new Date(Date.now() - 2 * 86400_000) } });
    expect(await isRateLimited("k", 1, 15 * 60_000)).toBe(false);
    await purgeOldAttempts();
    expect(await prisma.loginAttempt.count()).toBe(0);
  });
});

describe("controle de acesso por perfil", () => {
  it("psicóloga só enxerga a própria agenda, salvo autorização do administrador", () => {
    expect(visibleToUser(user("PSYCHOLOGIST"))).toEqual({ psychologistId: "psyA" });
    expect(visibleToUser(user("PSYCHOLOGIST", { canViewOthers: true }))).toEqual({});
    expect(visibleToUser(user("ADMIN"))).toEqual({});
    expect(visibleToUser(user("COORDINATION"))).toEqual({});
  });

  it("gerenciar agendamentos: admin sempre; coordenação conforme configuração; psicóloga só os próprios", () => {
    const own = { psychologistId: "psyA" };
    const other = { psychologistId: "psyB" };
    expect(canManageAppointment(user("ADMIN"), other, { coordinationCanCancel: false })).toBe(true);
    expect(canManageAppointment(user("COORDINATION"), other, { coordinationCanCancel: true })).toBe(true);
    expect(canManageAppointment(user("COORDINATION"), other, { coordinationCanCancel: false })).toBe(false);
    expect(canManageAppointment(user("PSYCHOLOGIST"), own, { coordinationCanCancel: false })).toBe(true);
    expect(canManageAppointment(user("PSYCHOLOGIST"), other, { coordinationCanCancel: true })).toBe(false);
  });

  it("disponibilidade: psicóloga não altera a agenda de outra; coordenação não altera nenhuma", () => {
    expect(() => assertCanManageAvailability(user("PSYCHOLOGIST"), "psyA")).not.toThrow();
    expect(() => assertCanManageAvailability(user("PSYCHOLOGIST"), "psyB")).toThrow();
    expect(() => assertCanManageAvailability(user("COORDINATION"), "psyA")).toThrow();
    expect(() => assertCanManageAvailability(user("ADMIN"), "psyB")).not.toThrow();
  });
});

describe("criptografia e identificadores", () => {
  it("AES-256-GCM: ida e volta, IV aleatório e detecção de adulteração", () => {
    const a = encrypt("refresh-token-123");
    const b = encrypt("refresh-token-123");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(decrypt(a)).toBe("refresh-token-123");
    const [iv, tag, data] = a.split(":");
    const tampered = [iv, tag, Buffer.from("xxxxxxxxxxxxxxxxx").toString("base64")].join(":");
    expect(() => decrypt(tampered)).toThrow();
    expect(data).toBeTruthy();
  });

  it("ID de evento do Google: estável por agendamento/destino e no alfabeto permitido", () => {
    expect(googleEventId("abc", "TEAM")).toBe(googleEventId("abc", "TEAM"));
    expect(googleEventId("abc", "TEAM")).not.toBe(googleEventId("abc", "PSYCHOLOGIST"));
    expect(googleEventId("abc", "TEAM")).toMatch(/^[a-v0-9]{40}$/);
  });
});

describe("validação de entrada (backend)", () => {
  it("telefone brasileiro, e-mail, nomes e senha forte", () => {
    expect(phoneSchema.parse("(81) 99999-0000")).toBe("81999990000");
    expect(phoneSchema.parse("+55 81 3333-4444")).toBe("8133334444");
    expect(() => phoneSchema.parse("123")).toThrow();
    expect(emailSchema.parse("  Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
    expect(() => emailSchema.parse("sem-arroba")).toThrow();
    expect(() => nameSchema("responsável").parse("Maria")).toThrow(); // precisa de sobrenome
    expect(() => nameSchema("responsável").parse("Maria <script>alert(1)</script>")).toThrow();
    expect(() => passwordSchema.parse("curta1A")).toThrow();
    expect(() => passwordSchema.parse("semnumeroAAAAAA")).toThrow();
    expect(passwordSchema.parse("SenhaForte123")).toBe("SenhaForte123");
  });
});
