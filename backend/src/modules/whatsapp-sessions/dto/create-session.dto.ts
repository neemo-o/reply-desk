import {
  IsString,
  IsOptional,
  IsIn,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

/**
 * Valores aceitos para `contactFilterMode` no SessionSettings.
 *
 * 🔒 S24-b — A semântica mudou: `blacklist` deixou de ser um modo (era um
 * estilo de banimento, não um modo de operação). Agora o modo só indica
 * se a whitelist está ATIVA (`"whitelist"`) ou INATIVA (`"none"`). A
 * blacklist, quando preenchida, SEMPRE bloqueia — independente do modo.
 *
 * Mantemos `"whitelist"` como o único estado "filtrando" (a regra
 * "whitelist vazia = passa tudo" continua) e `"none"` como atalho para
 * "desativar a whitelist completamente sem perder as listas salvas".
 *
 * Valores legados que aparecem no DB de tenants existentes serão
 * normalizados na leitura (ver `normalizeContactFilterMode`).
 */
export const CONTACT_FILTER_MODES = ['none', 'whitelist'] as const;
export type ContactFilterMode = (typeof CONTACT_FILTER_MODES)[number];

/**
 * 🔒 S24-b — Normaliza valores legados do enum `contactFilterMode`.
 *
 * - `'blacklist'` (modo antigo) → `'none'` (não tem mais sentido; blacklist
 *   agora é sempre tratada como banimento, nunca como modo de filtro).
 * - qualquer outro valor fora da whitelist de modos atuais → `'none'`.
 *
 * Use ao LER do banco para evitar mandar string inválida pro Prisma/UI.
 */
export function normalizeContactFilterMode(raw: unknown): ContactFilterMode {
  return raw === 'whitelist' ? 'whitelist' : 'none';
}

export class CreateSessionDto {
  /**
   * Nome de exibição da sessão dentro do tenant. Não precisa ser único
   * globalmente (sessionName gerado é quem é único), mas validamos
   * comprimento e carácteres para evitar problemas de UI/SQL injection.
   */
  @IsString()
  @Length(1, 80)
  @Matches(/^[a-zA-Z0-9áéíóúâêôãõçÀ-ÿ\s\-_().]+$/, {
    message: 'name contém caracteres não permitidos',
  })
  name: string;

  // 🔒 S23 — O campo `phone` foi REMOVIDO do DTO. O número do WhatsApp é
  // atribuído automaticamente quando o celular escaneia o QR Code (webhook
  // CONNECTION_UPDATE.wid.user). Não faz sentido perguntar ao usuário qual
  // número ele vai conectar — ele escolhe escaneando o QR.

  // 🔒 S24 — Bot ativo (obrigatório para a sessão ser conectável).
  // Validamos no service que o bot existe no mesmo tenant e está publicado
  // (status='active' ou 'testing'). Sem versões — o legado S24 foi removido.
  @IsUUID()
  activeBotId: string;

  // 🔒 S24 — Modo de filtragem de contatos. Default 'none' (comportamento
  // legado). O service cria SessionSettings junto com a sessão.
  @IsOptional()
  @IsIn(CONTACT_FILTER_MODES)
  contactFilterMode?: ContactFilterMode;
}
