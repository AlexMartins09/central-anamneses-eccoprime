/**
 * Estrutura preparada para a futura integração com a WhatsApp Business API (Cloud API da Meta).
 * Hoje NENHUM envio é feito: notificações com channel = WHATSAPP são marcadas como SKIPPED.
 *
 * Para ativar no futuro:
 *  1. Implementar `WhatsAppProvider` (ex.: CloudApiProvider usando WHATSAPP_TOKEN e WHATSAPP_PHONE_ID);
 *  2. Registrar templates aprovados pela Meta (confirmacao_anamnese, lembrete_anamnese);
 *  3. Em `queueBookingNotifications`/`queueReminders`, criar também registros com channel = WHATSAPP;
 *  4. Obter consentimento específico (opt-in) da família para contato por WhatsApp.
 */
export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendTemplate(toE164: string, template: string, params: string[]): Promise<void>;
}

export const whatsappProvider: WhatsAppProvider | null = null;
