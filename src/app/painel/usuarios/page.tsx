import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui/form";
import {
  createStaffUserAction,
  deleteStaffUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  updateStaffUserAction,
} from "@/server/admin-actions";

export const metadata = { title: "Usuários" };
const ROLE = { ADMIN: "Administrador", PSYCHOLOGIST: "Psicóloga", COORDINATION: "Atendimento / Coordenação" } as const;

export default async function UsersPage() {
  const me = await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: [{ role: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Usuários" description="Administração e atendimento. Psicólogas são gerenciadas na página própria." />
      <Card>
        <CardHeader><CardTitle>Novo usuário</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={createStaffUserAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Nome completo"><Input name="name" required /></Field>
            <Field label="E-mail"><Input name="email" type="email" required /></Field>
            <Field label="Perfil">
              <Select name="role" defaultValue="COORDINATION">
                <option value="COORDINATION">Atendimento / Coordenação</option>
                <option value="ADMIN">Administrador</option>
              </Select>
            </Field>
            <Field label="Senha inicial"><Input name="password" type="password" autoComplete="new-password" required /></Field>
            <SubmitButton className="sm:w-fit">Criar usuário</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {users.map((u) => {
          const isMe = u.id === me.id;
          const editable = u.role !== "PSYCHOLOGIST";
          return (
            <Card key={u.id}>
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-5">
                  <div>
                    <p className="font-semibold">{u.name}{isMe && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}</p>
                    <p className="text-sm text-muted-foreground">
                      {u.email} · {u.lastLoginAt ? `último acesso ${fmtDateTime(u.lastLoginAt)}` : "nunca acessou"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{ROLE[u.role]}</Badge>
                    <Badge variant={u.active ? "success" : "muted"}>{u.active ? "Ativo" : "Inativo"}</Badge>
                    <span className="text-xs font-medium text-primary">{editable ? "Editar" : ""}</span>
                  </div>
                </summary>
                {editable ? (
                  <div className="grid gap-6 border-t p-5 lg:grid-cols-3">
                    <ActionForm action={updateStaffUserAction} className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
                      <input type="hidden" name="id" value={u.id} />
                      <Field label="Nome"><Input name="name" defaultValue={u.name} required /></Field>
                      <Field label="E-mail"><Input name="email" type="email" defaultValue={u.email} required /></Field>
                      <Field label="Perfil" hint={isMe ? "Você não pode alterar o próprio perfil." : undefined}>
                        <Select name="role" defaultValue={u.role} disabled={isMe}>
                          <option value="COORDINATION">Atendimento / Coordenação</option>
                          <option value="ADMIN">Administrador</option>
                        </Select>
                      </Field>
                      <div className="flex items-end">
                        <SubmitButton size="sm">Salvar alterações</SubmitButton>
                      </div>
                    </ActionForm>

                    <div className="space-y-4">
                      <ActionForm action={resetUserPasswordAction} className="space-y-3 rounded-md bg-secondary/50 p-4">
                        <input type="hidden" name="id" value={u.id} />
                        <p className="text-sm font-medium">Redefinir senha</p>
                        <Input name="password" type="password" autoComplete="new-password" placeholder="Nova senha" required />
                        <SubmitButton size="sm" variant="outline">Redefinir</SubmitButton>
                      </ActionForm>

                      {!isMe && (
                        <div className="space-y-3 rounded-md bg-secondary/50 p-4">
                          <ActionForm action={setUserActiveAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={String(!u.active)} />
                            <SubmitButton size="sm" variant="outline">{u.active ? "Desativar acesso" : "Reativar acesso"}</SubmitButton>
                          </ActionForm>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-destructive">Excluir usuário</summary>
                            <ActionForm action={deleteStaffUserAction} className="mt-2 space-y-2">
                              <input type="hidden" name="id" value={u.id} />
                              <p className="text-xs text-muted-foreground">
                                O acesso é encerrado e o usuário some desta lista. O histórico de auditoria é mantido.
                              </p>
                              <SubmitButton size="sm" variant="destructive" pendingText="Excluindo…">Confirmar exclusão</SubmitButton>
                            </ActionForm>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </details>
            </Card>
          );
        })}
        {users.length === 0 && <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>}
      </div>
    </>
  );
}
