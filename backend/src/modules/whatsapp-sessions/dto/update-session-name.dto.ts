import { IsString, Length, Matches } from 'class-validator';

/**
 * DTO para PATCH /whatsapp/sessions/:id/name — renomeia o nome de exibição
 * (display name) da sessão dentro do tenant. NÃO mexe no `sessionName`
 * interno (que é o identificador único na Evolution API) nem no telefone.
 *
 * 🔒 S24-b — Validação idêntica ao `name` no CreateSessionDto: 1..80 chars,
 * apenas letras, números, espaços, hífen, underscore, parênteses e ponto.
 */
export class UpdateSessionNameDto {
  @IsString()
  @Length(1, 80)
  @Matches(/^[a-zA-Z0-9áéíóúâêôãõçÀ-ÿ\s\-_().]+$/, {
    message: 'name contém caracteres não permitidos',
  })
  name: string;
}
