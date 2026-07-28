import { IsString, Length, Matches } from 'class-validator';

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
}
