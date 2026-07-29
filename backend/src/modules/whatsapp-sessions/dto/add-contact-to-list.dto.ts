import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

/**
 * 🔒 S24 — POST /whatsapp/sessions/:id/settings/contacts
 * Adiciona um contato (existente ou novo) a uma lista da sessão.
 *
 * O fluxo na UI é:
 *   1. usuário digita número (ou seleciona contato existente)
 *   2. frontend chama GET /contacts?search=... pra escolher existente,
 *      OU cria manualmente via POST /contacts
 *   3. com o contactId em mãos, frontend chama ESTE endpoint passando
 *      { contactId, list: 'whitelist' | 'blacklist', note? }
 */
export const CONTACT_LISTS = ['whitelist', 'blacklist'] as const;
export type ContactList = (typeof CONTACT_LISTS)[number];

export class AddContactToListDto {
  @IsUUID()
  contactId: string;

  @IsIn(CONTACT_LISTS)
  list: ContactList;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

/**
 * 🔒 S24 — POST /contacts (criação manual por número).
 * Usado quando o owner quer adicionar à blacklist alguém que AINDA NÃO
 * mandou mensagem (contato não existe no DB). O backend faz upsert no
 * par (tenantId, phone) — se já existir, devolve o existente.
 */
export class CreateContactDto {
  /** Só dígitos, incluindo DDI. Sem o +, sem espaços, sem traços. */
  @IsString()
  @Matches(/^\d{8,15}$/, { message: 'phone deve conter 8–15 dígitos (DDI incluído)' })
  phone: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  notes?: string;
}
