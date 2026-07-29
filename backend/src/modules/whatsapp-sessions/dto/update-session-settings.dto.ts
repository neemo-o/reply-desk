import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { CONTACT_FILTER_MODES, type ContactFilterMode } from './create-session.dto';

/**
 * 🔒 S24 — DTO para PATCH /whatsapp/sessions/:id/settings.
 * Todos os campos são opcionais (PATCH parcial). O service valida que:
 *  - se activeBotId vier, bot existe no tenant + status='published'
 *  - se activeBotVersionId vier, pertence ao activeBotId
 *  - se contactFilterMode vier, está nos valores aceitos
 *
 * Importante: alterar essas configs NÃO fecha a sessão nem força reconexão
 * — o filtro roda no webhook inbound a partir do próximo MESSAGES_UPSERT.
 */
export class UpdateSessionSettingsDto {
  @IsOptional()
  @IsIn(CONTACT_FILTER_MODES)
  contactFilterMode?: ContactFilterMode;

  /**
   * Set null para "remover bot da sessão" — a UI manda explicitamente
   * `activeBotId: null` quando o usuário desvincula. Validamos UUID se
   * vier string, mas aceitamos null.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  activeBotId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  activeBotVersionId?: string | null;

  // Mantemos os toggles técnicos que já existiam no SessionSettings
  // (alguns fronts podem querer atualizar via esse mesmo endpoint).
  @IsOptional()
  autoReconnect?: boolean;
  @IsOptional()
  ignoreGroups?: boolean;
  @IsOptional()
  readMessages?: boolean;
  @IsOptional()
  typingIndicator?: boolean;
  @IsOptional()
  presenceUpdate?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  webhookUrl?: string;
}
