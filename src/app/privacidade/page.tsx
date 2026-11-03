import Link from "next/link";
import { getSettings, PRIVACY_VERSION } from "@/lib/settings";
import { Brand } from "@/components/brand";

export const metadata = { title: "Política de Privacidade" };

export default async function PrivacyPage() {
  const s = await getSettings();
  const contact = s.privacyContactEmail || "o canal de atendimento da escola";
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Brand s={s} />
          <Link href="/agendar" className="text-sm font-semibold text-primary underline">Voltar ao agendamento</Link>
        </div>
      </header>
      <main className="prose-sm mx-auto max-w-3xl space-y-6 px-4 py-10 leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">
        <div>
          <h1 className="text-3xl font-extrabold">Política de Privacidade</h1>
          <p className="mt-1 text-sm text-muted-foreground">Central de Agendamento de Anamneses · versão {PRIVACY_VERSION}</p>
        </div>

        <section>
          <h2>1. Quem é o controlador dos dados</h2>
          <p>A {s.brandName} é a controladora dos dados pessoais tratados nesta plataforma, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD).</p>
        </section>

        <section>
          <h2>2. Quais dados coletamos</h2>
          <ul>
            <li>Nome completo do responsável e do aluno;</li>
            <li>Telefone/WhatsApp e e-mail de contato;</li>
            <li>Segmento escolar, data e horário escolhidos;</li>
            <li>Registro técnico do aceite desta política (data/hora e endereço IP).</li>
          </ul>
          <p className="mt-2"><strong>Não solicitamos nem registramos</strong> informações clínicas, diagnósticos ou histórico psicológico neste sistema. Essas informações, se necessárias, são tratadas diretamente no atendimento, fora desta plataforma.</p>
        </section>

        <section>
          <h2>3. Para que usamos</h2>
          <p>Exclusivamente para: reservar o horário da anamnese, identificar a família no atendimento, enviar confirmação e lembretes e permitir que a equipe da escola reagende ou cancele quando necessário. Não utilizamos os dados para publicidade nem os vendemos.</p>
        </section>

        <section>
          <h2>4. Dados de crianças e adolescentes</h2>
          <p>Os dados do aluno são informados pelo responsável legal, com seu consentimento específico e em destaque (art. 14 da LGPD), e tratados no melhor interesse da criança ou do adolescente, somente na medida necessária ao agendamento.</p>
        </section>

        <section>
          <h2>5. Com quem compartilhamos</h2>
          <ul>
            <li>Equipe da escola (psicóloga responsável, atendimento e coordenação) — apenas o necessário para o atendimento;</li>
            <li>Google (Google Agenda), onde o compromisso é registrado com dados administrativos mínimos;</li>
            <li>Provedores de e-mail e de hospedagem/banco de dados, que atuam como operadores sob nossas instruções.</li>
          </ul>
        </section>

        <section>
          <h2>6. Por quanto tempo guardamos</h2>
          <p>Mantemos os dados por até {s.retentionMonths} meses após a data do atendimento. Depois disso, os dados pessoais são anonimizados ou excluídos, salvo obrigação legal de guarda.</p>
        </section>

        <section>
          <h2>7. Segurança</h2>
          <p>Utilizamos conexão criptografada (HTTPS), controle de acesso por perfil, registro de ações administrativas, senhas protegidas por hash e criptografia dos tokens de integração.</p>
        </section>

        <section>
          <h2>8. Seus direitos</h2>
          <p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, eliminação, portabilidade e informação sobre compartilhamentos, além de revogar o consentimento (arts. 17 a 18 da LGPD). Para exercer seus direitos, fale com {contact}.</p>
        </section>
      </main>
    </div>
  );
}
