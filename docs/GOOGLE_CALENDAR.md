# Integração com o Google Agenda

> **Status:** o código da integração está completo e testado com a API do Google simulada (`tests/google-sync.test.ts`).
> **Falta apenas a configuração externa abaixo** (credenciais OAuth). Até lá, os agendamentos funcionam normalmente e os eventos ficam marcados como **“Aguardando conexão”**; nada é perdido nem simulado.

## Como funciona
- Cada psicóloga conecta **a própria conta Google** (OAuth 2.0, escopo `calendar.events` — só cria/edita/remove eventos).
- O administrador conecta **uma conta** para a **agenda geral da equipe** e informa o ID do calendário que receberá todos os agendamentos.
- Ao confirmar um agendamento, o banco grava duas linhas de sincronização (`PSYCHOLOGIST` e `TEAM`) **na mesma transação** da reserva. Logo após a resposta ao usuário, o sistema tenta enviar ao Google; o que falhar é reenviado pelo worker (a cada 5 min, backoff exponencial, até 10 tentativas; o botão **Tentar novamente** zera as tentativas).
- **Sem duplicidade:** o ID do evento é determinístico (hash do agendamento + destino). Se o Google responder “já existe” (409), o evento é atualizado.
- **Cancelar** remove os eventos; **remarcar** atualiza (e, se mudar de psicóloga, remove da agenda antiga e cria na nova); **editar dados** atualiza a descrição.
- **Conteúdo do evento:** título `Anamnese – <Segmento>`; descrição com aluno, responsável, telefone, psicóloga e código. **Nenhum dado clínico**, nenhum convidado (a família não recebe convite do Google).
- Tokens de renovação ficam **criptografados (AES-256-GCM)** no banco com a `ENCRYPTION_KEY`.
- Se o acesso for revogado (`invalid_grant`), a conexão é desativada e a tela pede “Reconectar”.

## Passo a passo no Google Cloud
1. Acesse <https://console.cloud.google.com> e crie um projeto (ex.: “Agendamento Eccoprime”).
2. **APIs e serviços → Biblioteca →** ative **Google Calendar API**.
3. **Tela de permissão OAuth** (*OAuth consent screen*):
   - Se a escola usa **Google Workspace**, escolha **Interno** — recomendado: não exige verificação do Google e os tokens não expiram.
   - Se usar contas Gmail comuns, escolha **Externo** e **publique o app (“Em produção”)**. ⚠️ Em modo **“Testing”** o Google **expira o refresh token em 7 dias**, o que derrubaria a sincronização toda semana.
   - Escopos: `.../auth/calendar.events`, `openid`, `email`.
4. **Credenciais → Criar credenciais → ID do cliente OAuth →** tipo **Aplicativo da Web**:
   - **URIs de redirecionamento autorizados:** `https://SEU-DOMINIO/api/google/callback` (e `http://localhost:3000/api/google/callback` para testes locais).
5. Copie **ID do cliente** e **Chave secreta** para as variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` do Render e faça o redeploy.

## Agenda geral da equipe
1. Em uma conta (ex.: `atendimento@escola.com`), crie um calendário **“Anamneses – Equipe”** e compartilhe com a equipe de atendimento.
2. Compartilhe esse calendário com **a conta que o administrador vai conectar**, com permissão **“Fazer alterações em eventos”** (se for a própria dona, nada a fazer).
3. No sistema: **Google Agenda → Agenda geral da equipe → Conectar conta Google**; depois cole o **ID do calendário** (Configurações do calendário → *Integrar agenda* → *ID da agenda*) e clique em **Validar e salvar** (o sistema testa o acesso de escrita).

## Agenda de cada psicóloga
Cada psicóloga entra no sistema, abre **Google Agenda → Minha agenda Google → Conectar conta Google**, autoriza e (opcionalmente) escolhe outro calendário. Eventos que estavam aguardando conexão são enviados em seguida.

## Solução de problemas
| Sintoma | Causa provável | O que fazer |
|---|---|---|
| “Google não configurado no servidor” | Variáveis ausentes | Definir `GOOGLE_CLIENT_ID/SECRET` e redeploy |
| `redirect_uri_mismatch` | URI do Google ≠ `APP_URL`/callback | Cadastrar exatamente `APP_URL/api/google/callback` |
| “Não devolveu o token de renovação” | Conta já havia autorizado antes | Remover o app em myaccount.google.com/permissions e reconectar |
| “Reconexão necessária” | Token revogado/expirado (app em *Testing*) | Reconectar; publicar o app / usar tipo Interno |
| `Google Calendar 404` ao validar | ID errado ou sem permissão de escrita | Conferir ID e compartilhamento do calendário |
| Eventos “Falhou” | Instabilidade do Google/rede | Aguarde o worker ou clique em *Tentar novamente* |
