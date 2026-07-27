import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EvolutionWebhooksService } from './evolution-webhooks.service';
import { WhatsappSessionsService } from '../whatsapp-sessions/whatsapp-sessions.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 🔒 Endpoint público de webhook da Evolution API.
 *
 * A Evolution API NÃO se autentica via JWT — ela POSTa eventos para o
 * backend. A segurança vem da "assinatura por instância": cada sessão
 * cria um secret aleatório, que é configurado na Evolution como header
 * customizado (`x-evolution-signature`) no webhook.set → `headers`.
 * A Evolution repassa esse mesmo header em todas as chamadas de webhook.
 *
 * Aqui:
 *   1. Pegamos `instance` (sessionName) do body → identifica a sessão.
 *   2. Buscamos a sessão no DB e argon2.verify(header vs webhookSecretHash).
 *   3. Se válido, processamos o evento (EvolutionWebhooksService).
 *   4. Se inválido: 403 Forbidden (sem revelar qq detalhe).
 *
 * Exemplo body da Evolution:
 *   {
 *     "event": "CONNECTION_UPDATE",
 *     "instance": "rd-abc12345-...",
 *     "data": { "state": "open", "wid": { "user": "55119..." } },
 *     "date": "2026-07-27T..."
 *   }
 *
 * 🔒 Idempotência: futuras mensagens podem vir repetidas por retry da
 * Evolution; por enquanto apenas processamos — MESSAGES_UPSERT/UPDATE
 * terá idempotência via unique([conversationId, externalId]) na tabela
 * messages (já existente no schema).
 */
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  private readonly logger = new Logger(EvolutionWebhookController.name);

  constructor(
    private readonly evolutionWebhooksService: EvolutionWebhooksService,
    private readonly sessionsService: WhatsappSessionsService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @Post()
  async handle(
    @Body() body: { event?: string; instance?: string; data?: unknown; date?: string },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const instanceName = body?.instance;
    if (!instanceName) {
      this.logger.warn('webhook Evolution sem campo `instance`');
      throw new ForbiddenException('Instância não informada');
    }

    const signature = headers['x-evolution-signature'];
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;

    const valid = await this.sessionsService.verifyWebhookSignature(
      instanceName,
      signatureStr,
    );
    if (!valid) {
      this.logger.warn(`webhook Evolution rejeitado — assinatura inválida para instância "${instanceName}"`);
      throw new ForbiddenException('Assinatura do webhook inválida');
    }

    await this.evolutionWebhooksService.handleEvent(body);
    return { ok: true };
  }
}
