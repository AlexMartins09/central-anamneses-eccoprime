import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { smtpConfig } from "@/lib/env";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { runRetentionAction, saveSettingsAction } from "@/server/settings-actions";
import { retryNotificationAction } from "@/server/appointment-actions";

export const metadata = { title: "Configurações" };
const checkbox = "size-4 accent-[hsl(var(--primary))]";

export default async function SettingsPage() {
  await requireUser(["ADMIN"]);
  const s = await getSettings();
  const smtp = smtpConfig();
  const [pending, failed] = await Promise.all([
    prisma.notification.count({ where: { status: "PENDING" } }),
    prisma.notification.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);

  return (
    <>
      <PageHeader title="Configurações do sistema" description="Identidade visual, regras de agendamento, notificações e privacidade." />

      <ActionForm action={saveSettingsAction} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Identidade visual</CardTitle><CardDescription>Cores no formato HSL “matiz saturação% luminosidade%” (ex.: 215 70% 28%).</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da escola"><Input name="brandName" defaultValue={s.brandName} required /></Field>
            <Field label="Subtítulo"><Input name="brandTagline" defaultValue={s.brandTagline} /></Field>
            <Field label="Endereço (URL https) do logotipo" hint="Deixe em branco para usar o ícone padrão." className="sm:col-span-2"><Input name="logoUrl" defaultValue={s.logoUrl} placeholder="https://…/logo.png" /></Field>
            <Field label="Cor principal (HSL)"><Input name="colorPrimary" defaultValue={s.colorPrimary} required /></Field>
            <Field label="Cor de destaque (HSL)"><Input name="colorAccent" defaultValue={s.colorAccent} required /></Field>
            <Field label="Texto de boas-vindas (página pública)" className="sm:col-span-2"><Textarea name="welcomeText" defaultValue={s.welcomeText} rows={3} required /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Regras de agendamento</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Duração padrão do atendimento (min)"><Input type="number" name="defaultDurationMinutes" defaultValue={s.defaultDurationMinutes} min={10} max={240} /></Field>
            <Field label="Antecedência mínima (horas)" hint="Famílias não agendam horários mais próximos que isto."><Input type="number" name="minLeadHours" defaultValue={s.minLeadHours} min={0} /></Field>
            <Field label="Abertura máxima (dias à frente)"><Input type="number" name="maxDaysAhead" defaultValue={s.maxDaysAhead} min={1} max={365} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="coordinationCanCancel" defaultChecked={s.coordinationCanCancel} className={checkbox} /> Atendimento/Coordenação pode cancelar, remarcar e editar agendamentos
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notificações</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Lembrete — antecedência (horas)"><Input type="number" name="reminderHoursBefore" defaultValue={s.reminderHoursBefore} min={1} /></Field>
            <label className="flex items-center gap-2 text-sm sm:self-end sm:pb-2">
              <input type="checkbox" name="remindersEnabled" defaultChecked={s.remindersEnabled} className={checkbox} /> Enviar lembretes às famílias
            </label>
            <Field label="E-mails da equipe de atendimento (um por linha)" hint="Recebem aviso de cada novo agendamento." className="sm:col-span-2">
              <Textarea name="teamEmails" defaultValue={s.teamEmails.join("\n")} rows={3} />
            </Field>
            <Field label="Orientações para comparecimento (vão nos e-mails e na confirmação)" className="sm:col-span-2">
              <Textarea name="attendanceInstructions" defaultValue={s.attendanceInstructions} rows={3} required />
            </Field>
            <Field label="Telefone/WhatsApp da escola (exibido às famílias)"><Input name="schoolContactPhone" defaultValue={s.schoolContactPhone} /></Field>
            <Field label="ID do calendário geral (Google)" hint="Também ajustável na página Google Agenda."><Input name="teamCalendarId" defaultValue={s.teamCalendarId} /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Privacidade (LGPD)</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Retenção dos dados pessoais (meses após o atendimento)" hint="Depois disso os dados são anonimizados automaticamente."><Input type="number" name="retentionMonths" defaultValue={s.retentionMonths} min={6} max={120} /></Field>
            <Field label="Canal de contato para direitos do titular"><Input name="privacyContactEmail" defaultValue={s.privacyContactEmail} placeholder="privacidade@escola.com.br" /></Field>
          </CardContent>
        </Card>
        <SubmitButton size="lg">Salvar configurações</SubmitButton>
      </ActionForm>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between"><CardTitle>Envio de e-mails</CardTitle><Badge variant={smtp.configured ? "success" : "warning"}>{smtp.configured ? "SMTP configurado" : "SMTP não configurado"}</Badge></div>
          <CardDescription>{pending} e-mail(s) na fila. {smtp.configured ? `Remetente: ${smtp.from}` : "Defina SMTP_HOST/SMTP_USER/SMTP_PASS no ambiente; os e-mails ficam guardados e são enviados assim que o SMTP estiver ativo."}</CardDescription>
        </CardHeader>
        <CardContent>
          {failed.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum e-mail com falha definitiva.</p> : (
            <ul className="divide-y text-sm">
              {failed.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><strong>{n.toAddress}</strong> — {n.subject}<span className="block truncate text-xs text-muted-foreground">{n.lastError} · {fmtDateTime(n.updatedAt)}</span></span>
                  <ActionForm action={retryNotificationAction}><input type="hidden" name="notificationId" value={n.id} /><SubmitButton size="sm" variant="outline">Reenviar</SubmitButton></ActionForm>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Retenção e backup</CardTitle><CardDescription>A anonimização roda automaticamente pelo worker diário. Backup do banco: veja docs/DEPLOY.md.</CardDescription></CardHeader>
        <CardContent>
          <ActionForm action={runRetentionAction}><SubmitButton variant="outline">Executar anonimização agora</SubmitButton></ActionForm>
        </CardContent>
      </Card>
      <Alert>WhatsApp Business API: a estrutura (canal de notificação e interface de provedor) está pronta em <code>src/lib/whatsapp.ts</code>; o envio será ativado quando houver conta aprovada na Meta.</Alert>
    </>
  );
}
