import { OAuth2Client } from "google-auth-library";
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import type { ConnectionKind, GoogleCalendarConnection } from "@prisma/client";
import { prisma } from "./db";
import { authSecret, googleConfig } from "./env";
import { decrypt, encrypt } from "./crypto";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const API = "https://www.googleapis.com/calendar/v3";

export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public reconnectRequired = false) {
    super(message);
  }
}

function oauthClient(): OAuth2Client {
  const c = googleConfig();
  if (!c.configured) {
    throw new GoogleApiError(0, "Google não configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ausentes).");
  }
  return new OAuth2Client(c.clientId, c.clientSecret, c.redirectUri);
}

type StatePayload = { kind: ConnectionKind; psychologistId: string | null; userId: string };

/** URL de consentimento OAuth. O `state` é um JWT assinado de 10 min (proteção contra CSRF/troca de contas). */
export async function buildAuthUrl(state: StatePayload): Promise<string> {
  const signed = await new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(authSecret());
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: signed,
    include_granted_scopes: true,
  });
}

export async function readState(token: string): Promise<StatePayload> {
  const { payload } = await jwtVerify(token, authSecret(), { algorithms: ["HS256"] });
  return {
    kind: payload.kind as ConnectionKind,
    psychologistId: (payload.psychologistId as string | null) ?? null,
    userId: payload.userId as string,
  };
}

/** Troca o código por tokens e guarda o refresh token criptografado. */
export async function completeConnection(code: string, state: StatePayload): Promise<GoogleCalendarConnection> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new GoogleApiError(
      400,
      "O Google não devolveu o token de renovação. Remova o acesso do app em myaccount.google.com/permissions e tente novamente.",
    );
  }
  const email = tokens.id_token ? (decodeJwt(tokens.id_token).email as string | undefined) : undefined;
  const data = {
    googleEmail: email ?? "desconhecido",
    refreshTokenEnc: encrypt(tokens.refresh_token),
    active: true,
    lastError: null,
  };
  const existing = await prisma.googleCalendarConnection.findFirst({
    where: { kind: state.kind, psychologistId: state.psychologistId },
  });
  if (existing) return prisma.googleCalendarConnection.update({ where: { id: existing.id }, data });
  return prisma.googleCalendarConnection.create({
    data: { ...data, kind: state.kind, psychologistId: state.psychologistId, calendarId: "primary" },
  });
}

export async function revokeConnection(conn: GoogleCalendarConnection) {
  try {
    await oauthClient().revokeToken(decrypt(conn.refreshTokenEnc));
  } catch {
    /* melhor esforço: o token pode já ter sido revogado */
  }
}

async function accessTokenFor(conn: GoogleCalendarConnection): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(conn.refreshTokenEnc) });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("sem token");
    return token;
  } catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    if (/invalid_grant|unauthorized_client|invalid_client/i.test(msg)) {
      await prisma.googleCalendarConnection.update({
        where: { id: conn.id },
        data: { active: false, lastError: "Acesso revogado ou expirado. Reconecte a conta Google." },
      });
      throw new GoogleApiError(401, "Acesso ao Google revogado. É preciso reconectar a conta.", true);
    }
    throw new GoogleApiError(0, `Falha ao obter token do Google: ${msg}`);
  }
}

export type EventBody = {
  id?: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status?: "confirmed" | "cancelled";
  extendedProperties?: { private: Record<string, string> };
};

async function call(conn: GoogleCalendarConnection, calendarId: string, method: string, path: string, body?: unknown) {
  const token = await accessTokenFor(conn);
  let res: Response;
  try {
    res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GoogleApiError(0, `Sem conexão com o Google: ${(e as Error).message}`);
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  const text = await res.text().catch(() => "");
  throw new GoogleApiError(res.status, `Google Calendar ${res.status}: ${text.slice(0, 300)}`);
}

/** Cria o evento com ID determinístico; se já existir (409), atualiza — nunca duplica. */
export async function upsertEvent(conn: GoogleCalendarConnection, calendarId: string, eventId: string, body: EventBody, knownToExist: boolean) {
  const full = { ...body, id: eventId, status: "confirmed" as const };
  const insert = () => call(conn, calendarId, "POST", "", full);
  const update = () => call(conn, calendarId, "PUT", `/${eventId}`, full);
  try {
    return await (knownToExist ? update() : insert());
  } catch (e) {
    if (e instanceof GoogleApiError) {
      if (!knownToExist && e.status === 409) return update();
      if (knownToExist && e.status === 404) return insert();
    }
    throw e;
  }
}

export async function deleteEvent(conn: GoogleCalendarConnection, calendarId: string, eventId: string) {
  try {
    await call(conn, calendarId, "DELETE", `/${eventId}`);
  } catch (e) {
    // 404/410: já não existe -> objetivo atingido
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

/** Confere se a conta consegue escrever no calendário informado (usado no botão "Testar conexão"). */
export async function testCalendarAccess(conn: GoogleCalendarConnection, calendarId: string): Promise<void> {
  const token = await accessTokenFor(conn);
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GoogleApiError(res.status, `Sem acesso ao calendário (${res.status}). Verifique o ID e as permissões.`);
}
