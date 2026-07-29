import {
  IsString,
  IsOptional,
  IsIn,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

/**
 * Valores aceitos para `contactFilterMode` no SessionSettings.
 * Espelha o CHECK mental que o service faz antes de gravar.
 */
export const CONTACT_FILTER_MODES = ['none', 'whitelist', 'blacklist'] as const;
export type ContactFilterMode = (typeof CONTACT_FILTER_MODES)[number];

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
  // Validamos no service que o bot existe no mesmo tenant, está com
  // status='published' e que activeBotVersionId (se informado) pertence a
  // esse bot. Se inválido → sessão criada em 'draft' (sem enfileirar
  // connect-session na Evolution).
  @IsUUID()
  activeBotId: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID()
  activeBotVersionId?: string;

  // 🔒 S24 — Modo de filtragem de contatos. Default 'none' (comportamento
  // legado). O service cria SessionSettings junto com a sessão.
  @IsOptional()
  @IsIn(CONTACT_FILTER_MODES)
  contactFilterMode?: ContactFilterMode;
}
