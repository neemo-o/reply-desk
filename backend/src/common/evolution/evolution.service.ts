import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 🔌 EvolutionService — camada própria de integração com a Evolution API.
 *
 * A Evolution API é tratada como um serviço EXTERNO responsável
 * exclusivamente pela conexão e persistência das sessões do WhatsApp.
 * Os dados de autenticação (credenciais do WhatsApp, session state) ficam
 * no armazenamento persistente da própria Evolution (volume /evolution_data).
 * Este serviço NUNCA persiste QR Code ou credenciais no banco — apenas
 * orquestra chamadas REST à Evolution e devolve resultados ao caller.
 *
 * Endpoints (Evolution API v2, base http://host:8080/):
 *   POST   /instance/create            cria instância (+webhook opcional)
 *   GET    /instance/connect/{name}    conecta e devolve QR Code (base64)
 *   GET    /instance/fetchInstances    lista/estado das instâncias
 *   POST   /instance/restart/{name}    reinicia instância
 *   DELETE /instance/logout/{name}     logout (encerra sessão, mantém instância)
 *   DELETE /instance/delete/{name}     deleta instância
 *   POST   /webhook/set/{name}         configura webhook da instância
 *   GET    /webhook/find/{name}        consulta webhook configurado
 *
 * Autenticação: header `apikey: <EVOLUTION_API_KEY>` em toda chamada.
 * Validação de webhooks (callback da Evolution → backend): token por
 * instância enviado como header customizado via webhook.set `headers`.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly webhookBaseUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('evolution.url') ?? '').replace(/\/$/, '');
    this.apiKey = this.config.get<string>('evolution.apiKey');
    this.webhookBaseUrl = (this.config.get<string>('evolution.webhookBaseUrl') ?? '').replace(/\/$/, '');
    if (!this.baseUrl) {
      // Não lançamos no construtor (quebra o DI em testes sem env). Lançamos
      // em runtime quando uma chamada real é feita.
      this.logger.warn('EVOLUTION_API_URL não configurada — chamadas à Evolution falharão.');
    }
  }

  assertConfigured() {
    if (!this.baseUrl) {
      throw new BadGatewayException('EVOLUTION_API_URL não configurada no backend');
    }
    if (!this.apiKey) {
      throw new BadGatewayException('EVOLUTION_API_KEY não configurada no backend');
    }
  }

  /**
   * Eventos padrão que queremos receber da Evolution para sincronizar estado.
   * Documentados em `/api-reference/events-events` (Evolution API v2).
   */
  static readonly WEBHOOK_EVENTS = [
    'APPLICATION_STARTUP',
    'QRCODE_UPDATED',
    'CONNECTION_UPDATE',
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'MESSAGES_DELETE',
    'SEND_MESSAGE',
    'CONTACTS_UPSERT',
    'PRESENCE_UPDATE',
  ] as const;

  /**
   * Wrapper de fetch sanitize: monta headers admitidos, trata erros HTTP
   * e converte body não-2xx em BadGatewayException.
   */
  private async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.assertConfigured();
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      apikey: this.apiKey as string,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let resp: Response;
    try {
      resp = await fetch(url, init);
    } catch (err) {
      this.logger.error(`Evolution ${method} ${path} falhou: ${(err as Error).message}`);
      throw new BadGatewayException('Não foi possível falar com a Evolution API');
    }

    if (!resp.ok) {
      let text = '';
      try {
        text = await resp.text();
      } catch {
        /* ignore */
      }
      // 404 na Evolution: instância não encontrada (provavelmente deletada)
      if (resp.status === 404) {
        throw new NotFoundException(`Recurso não encontrado na Evolution API: ${path}`);
      }
      this.logger.error(
        `Evolution ${method} ${path} → ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`,
      );
      throw new BadGatewayException(
        `Evolution API respondeu ${resp.status} ${resp.statusText}`,
      );
    }

    if (resp.status === 204) return undefined as T;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      // alguns endpoints (logout) retornam texto
      return (await resp.text()) as unknown as T;
    }
    return (await resp.json()) as T;
  }

  // ─── Instâncias ────────────────────────────────────────────────────

  /**
   * Cria uma instância na Evolution API.
   * Evolução suporta webhook inline no create (`webhook: {...}`), mas
   * passamos aqui as infos para já deixar a instância criada e conectada
   * com webhook configurado num único chamado (reduz race conditions).
   *
   * @param instanceName Nome único da instância (formato: rd-<tenant>-<rand>)
   * @param webhookUrl  URL pública do backend onde a Evolution POSTa os
   *                    eventos: <EVOLUTION_WEBHOOK_BASE_URL>/webhooks/evolution
   * @param webhookSignatureHeader  Objeto header customizado que a Evolution
   *                                enviará em todas as chamadas de webhook
   *                                para validação por instância.
   */
  async createInstance(input: {
    instanceName: string;
    webhookUrl: string;
    webhookSignatureHeader: Record<string, string>;
    number?: string;
  }): Promise<{
    instance: { instanceId: string; instanceName: string };
    hash?: string;
    qrcode?: { code: string; base64?: string };
  }> {
    const payload = {
      instanceName: input.instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      ...(input.number ? { number: input.number } : {}),
      webhook: {
        enabled: true,
        url: input.webhookUrl,
        // 🔒 Token de validação por instância. A Evolution repassa esses
        // headers em todas as chamadas de webhook; o backend valida no
        // controller /webhooks/evolution comparando contra o
        // webhookSecretHash armazenado por sessão.
        headers: input.webhookSignatureHeader,
        events: [...EvolutionService.WEBHOOK_EVENTS],
      },
    };
    return this.call('POST', '/instance/create', payload);
  }

  /**
   * Conecta a instância e devolve o QR Code atual para autenticação.
   * O QR é retornado sob demanda — NUNCA persistido no banco.
   */
  async connect(instanceName: string): Promise<{
    base64?: string;
    code?: string;
    // alguns fluxos retornam pairingCode ara WhatsApp multi-dispositivo
    pairingCode?: string;
  }> {
    return this.call('GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
  }

  /**
   * Consulta o estado atual da instância na Evolution.
   * Retorna o estado low-level (`state`) e, se conectado, o número.
   */
  async fetchInstance(instanceName: string): Promise<{
    instance?: { id: string; name: string; state: string; connection: string };
    data?: unknown;
  }> {
    // fetchInstances suporta query ?instanceName=<name> em algumas builds.
    // Tentamos pelo caminho mais robusto: /instance/fetchInstances
    const data = await this.call<{ data?: unknown }>(
      'GET',
      `/instance/fetchInstances/${encodeURIComponent(instanceName)}`,
    );
    return data;
  }

  /**
   * Reinicia a instância na Evolution (resolve e reconecta a sessão).
   */
  async restart(instanceName: string): Promise<unknown> {
    return this.call('POST', `/instance/restart/${encodeURIComponent(instanceName)}`);
  }

  /**
   * Logout: encerra a sessão do WhatsApp mas MANTÉM a instância (pode
   * reconectar depois). Usado quando o usuário quer "desligar" sem
   * excluir a sessão.
   */
  async logout(instanceName: string): Promise<unknown> {
    return this.call('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  /**
   * Deleta a instância permanentemente da Evolution API. As credenciais
   * persistidas em /evolution_data são removidas e a sessão fica irreversível.
   */
  async deleteInstance(instanceName: string): Promise<unknown> {
    return this.call('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  // ─── Webhooks (configuração da instância) ──────────────────────────

  /**
   * Configura (ou reconfigura) o webhook de uma instância.
   * Útil para atualizar a URL de callback ou o secret de validação sem
   * recriar a instância.
   */
  async setWebhook(instanceName: string, input: {
    url: string;
    signatureHeader: Record<string, string>;
  }): Promise<unknown> {
    const payload = {
      enabled: true,
      url: input.url,
      headers: input.signatureHeader,
      events: [...EvolutionService.WEBHOOK_EVENTS],
      base64: true,
    };
    return this.call('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, payload);
  }

  async findWebhook(instanceName: string): Promise<unknown> {
    return this.call('GET', `/webhook/find/${encodeURIComponent(instanceName)}`);
  }

  // ─── Envio de mensagens ────────────────────────────────────────────

  /**
   * Envia uma mensagem de texto via Evolution API.
   * Endpoint: POST /message/sendText/{instance}
   *
   * Payload (Evolution API v2, integration WHATSAPP-BAILEYS):
   *   {
   *     number:  "5511999999999",        // E.164 sem +, sem @s.whatsapp.net
   *     options: { delay: 1200, ... },
   *     textMessage: { text: "..." }
   *   }
   *
   * Retorno (típico): { key: { id, ... }, message: { ... }, status: "PENDING"|"SENT" }
   */
  async sendText(instanceName: string, input: {
    number: string;
    text: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    const payload = {
      number: input.number,
      options: { delay: input.delayMs ?? 1200 },
      textMessage: { text: input.text },
    };
    return this.call('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, payload);
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Constrói a URL pública absoluta do endpoint de webhook da Evolution
   * no backend. Combina EVOLUTION_WEBHOOK_BASE_URL + prefix global do
   * Nest (`api/v1`) + rota do controller.
   */
  buildWebhookUrl(): string {
    if (!this.webhookBaseUrl) {
      throw new BadGatewayException('EVOLUTION_WEBHOOK_BASE_URL não configurada no backend');
    }
    // If base_url já inclui /api/v1 (ex.: tunnel de produção), anexamos só a rota.
    if (this.webhookBaseUrl.endsWith('/api/v1')) {
      return `${this.webhookBaseUrl}/webhooks/evolution`;
    }
    return `${this.webhookBaseUrl}/api/v1/webhooks/evolution`;
  }
}
