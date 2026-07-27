import { IsOptional, IsString, Length, Matches } from 'class-validator';

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

  /**
   * Número de telefone opcional em formato E.164 (ex.: 5511999999999).
   * Se informado, é pré-configurado na Evolution para pairing code.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,20}$/, { message: 'phone deve conter apenas dígitos (E.164)' })
  phone?: string;
}
