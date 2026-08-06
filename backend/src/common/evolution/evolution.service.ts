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
   * Eventos que o ReplyDesk recebe da Evolution.
   *
   * Apenas 4 eventos — o suficiente para o fluxo "QR → conectado → recebe
   * mensagens privadas → placeholder → desconecta". Os outros eventos
   * (PRESENCE_UPDATE, CONTACTS_UPSERT, MESSAGES_UPDATE, MESSAGES_DELETE,
   * SEND_MESSAGE) foram intencionalmente removidos por dois motivos:
   *
   *  1. **Privacidade** — não queremos que a Evolution envie por webhook
   *     informações sobre a agenda de contatos, status online/digitando,
   *     edições de mensagens etc. do usuário. Esses eventos só servem para
   *     feature sociais que não fazem parte do produto.
   *  2. **Performance** — esses eventos geravam alto volume de POSTs por
   *     minuto (ex.: 70 PRESENCE_UPDATE + 46 MESSAGES_UPDATE + 28
   *     CONTACTS_UPSERT por sessão em atividade), o que estourou o
   *     rate limiter do endpoint /webhooks/evolution (HTTP 429).
   *
   * Se no futuro o produto precisar de algum evento novo (ex.: receber
   * edições de mensagem para reconstruir histórico), basta adicioná-lo aqui
   * e fazer rebuild do backend — o `createInstance()` e `setWebhook()`
   * usam essa constante automaticamente.
   *
   * Referência Evolution API v2: `/api-reference/events-events`.
   */
  static readonly WEBHOOK_EVENTS = [
    'APPLICATION_STARTUP', // 🔌 Evolution reiniciou — apenas atualiza lastSeen
    'QRCODE_UPDATED',      // 🔌 QR gerado/atualizado — frontend busca sob demanda
    'CONNECTION_UPDATE',   // 🔌 conectado/desconectado/connecting — essencial p/ status
    'MESSAGES_UPSERT',     // 📨 mensagem recebida (privado, !fromMe) — fluxo principal
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
   *
   * 🔒 A Evolution API v2 (builds recentes) aceita a consulta de duas formas:
   *   - GET /instance/fetchInstances?instanceName=<name>   (query string)
   *   - GET /instance/fetchInstances/{name}                (path — funciona em builds antigos)
   * Alguns builds retornam 404 em uma das duas; tentamos query-string primeiro
   * (que é a forma documentada em builds recentes) e caímos para path se 404.
   */
  async fetchInstance(instanceName: string): Promise<{
    instance?: { id: string; name: string; state: string; connection: string };
    data?: unknown;
  }> {
    this.assertConfigured();
    const headers: Record<string, string> = {
      apikey: this.apiKey as string,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // 1ª tentativa: query string (documentada em builds recentes).
    try {
      const url = `${this.baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`;
      const resp = await fetch(url, { method: 'GET', headers });
      if (resp.ok) {
        const json = (await resp.json()) as unknown;
        // Algumas builds envelopam em { data: [...] } ou devolvem array direto.
        // Quando é array, pegamos o primeiro item (já filtrado por ?instanceName=).
        if (Array.isArray(json)) return { data: json[0] ?? null };
        return json as { data?: unknown };
      }
      // Se não for 404, propaga como erro genérico (não tenta fallback).
      if (resp.status !== 404) {
        throw new BadGatewayException(
          `Evolution API respondeu ${resp.status} ${resp.statusText}`,
        );
      }
      this.logger.debug(
        `fetchInstance(${instanceName}): query-string → 404; tentando path…`,
      );
    } catch (err) {
      // Erros de rede ou BadGateway (≠ 404) devem propagar; 404 cai no path legacy.
      if (err instanceof BadGatewayException) throw err;
      this.logger.debug(
        `fetchInstance(${instanceName}): query-string falhou (${(err as Error).message}); tentando path…`,
      );
    }
    // 2ª tentativa: path legado (/instance/fetchInstances/{name}).
    return this.call<{ data?: unknown }>(
      'GET',
      `/instance/fetchInstances/${encodeURIComponent(instanceName)}`,
    );
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

  // --- Perfil (consulta de nome do dono do numero) -------------------

  /**
   * Consulta o perfil publico do dono do numero (o nome que aparece no
   * WhatsApp quando a conta e de pessoa fisica, ou o nome comercial quando
   * e Business). A Evolution não envia esse nome nem no webhook
   * CONNECTION_UPDATE nem no fetchInstances (ambos devolvem profileName=null),
   * por isso precisamos de uma chamada explícita.
   *
   * Endpoint: POST /chat/fetchProfile/{instanceName}
   *   Body: { number: "<E.164 sem +>" }
   * Retorno típico (integration WHATSAPP-BAILEYS):
   *   {
   *     wuid: "5511999999999@s.whatsapp.net",
   *     name: "Empresa XY",            // ← nome do perfil (pessoa física)
   *     pushName: "Empresa XY",         // ← alias em alguns builds
   *     business: false,
   *     businessProfile: { name: "..." } // ← só quando conta Business
   *   }
   *
   * @param instanceName Nome da instância conectada.
   * @param number       Telefone E.164 sem "+" (ex.: "5511999999999").
   */
  async fetchProfile(instanceName: string, number: string): Promise<{
    name?: string | null;
    pushName?: string | null;
    business?: boolean;
    businessProfile?: { name?: string | null } | null;
  }> {
    const payload = { number };
    return this.call('POST', `/chat/fetchProfile/${encodeURIComponent(instanceName)}`, payload);
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
   * Payload (Evolution API v2.3+):
   *   {
   *     number:  "5511999999999",        // E.164 sem +, sem @s.whatsapp.net
   *     options: { delay: 1200, ... },
   *     text:    "..."                    // 📌 campo 'text' no NÍVEL SUPERIOR
   *   }
   *
   * 🔒 M24 — A Evolution API v2.3.7 alterou o schema deste endpoint. Em
   * builds anteriores o texto era enviado dentro de `textMessage.text`; em
   * v2.3.7 isso retorna HTTP 400 com `instance requires property "text"`.
   * O texto passou a ser exigido no nível superior do payload como `text`.
   * Comparação viva (rd-54dd700f, 2026-08-05):
   *   - { number, textMessage:{text:"x"} } → 400 instance requires property "text"
   *   - { number, text:"x" }               → 200 PENDING, mensagem entregue
   * Mantemos retrocompatibilidade bilateral enviando `text` no nível superior
   * (suportado por builds recentes) — o `textMessage` legado foi removido
   * porque builds recentes o rejeitam.
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
      text: input.text,
    };
    return this.call('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, payload);
  }

  // ─── Envio de tipos avançados (bot engine + broadcast) ───────────────
  // Todos aceitam `number` (E.164 sem +) e devolvem { key, status }.

  // ─── Mídia (Evolution API v2.3.7 — DTOs SendMediaDto / SendAudioDto / SendStickerDto) ───
  // Payload FLAT no body (não aninhado sob `mediaMessage`).
  // `mediatype` é all-lowercase no wire. Tape de mídia aceita: image | video | document | audio.
  // Sticker usa endpoint separado SendStickerDto (campo `sticker`, sem mediatype).
  // Áudio (PTT) usa endpoint separado `sendWhatsAppAudio` (campo `audio`, sem mediatype).
  async sendImage(instanceName: string, input: {
    number: string;
    url: string;
    caption?: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      mediatype: 'image',
      media: input.url,
      ...(input.caption ? { caption: input.caption } : {}),
      delay: input.delayMs ?? 1200,
    });
  }

  async sendVideo(instanceName: string, input: {
    number: string;
    url: string;
    caption?: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      mediatype: 'video',
      media: input.url,
      ...(input.caption ? { caption: input.caption } : {}),
      delay: input.delayMs ?? 1200,
    });
  }

  async sendAudio(instanceName: string, input: {
    number: string;
    url: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    // SendAudioDto: { number, audio, delay } — PTT (push-to-talk) no WhatsApp.
    return this.call('POST', `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      audio: input.url,
      delay: input.delayMs ?? 1200,
    });
  }

  async sendDocument(instanceName: string, input: {
    number: string;
    url: string;
    filename: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      mediatype: 'document',
      media: input.url,
      fileName: input.filename,
      delay: input.delayMs ?? 1200,
    });
  }

  async sendSticker(instanceName: string, input: {
    number: string;
    url: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    // SendStickerDto: { number, sticker, delay } — endpoint próprio.
    return this.call('POST', `/message/sendSticker/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      sticker: input.url,
      delay: input.delayMs ?? 1200,
    });
  }

  /**
   * Lista interativa (WhatsApp). Somente 1 seção suportada (limite Evolution).
   * Cada row precisa { id, title, description? }.
   * Payload flat conforme SendListDto/`listMessageSchema` da Evolution API v2.3.7
   * (required: number, title, footerText, buttonText, sections). Em v2.3.7 o DTO
   * tem também `description?` (subtítulo do proto.ListMessage) — enviamos sempre
   * como string (default '') para evitar bug do Baileys onde um `description`
   * undefined faz o `ContextInfo.toObject` quebrar (`this.isZero is not a function`).
   * Igualmente cada row recebe `description: string` (default '') nunca omitida.
   */
  async sendList(instanceName: string, input: {
    number: string;
    title: string;
    footerText: string;
    buttonText: string;
    sections: {
      title: string;
      rows: { id: string; title: string; description?: string }[];
    }[];
    delayMs?: number;
    /// Subtítulo exibido abaixo do título (campo `description` do proto.ListMessage).
    /// Recomendado enviar sempre preenchido para evitar o bug do Long no Baileys.
    description?: string;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    const description = (input.description ?? '').toString();
    return this.call('POST', `/message/sendList/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      title: input.title,
      description,
      footerText: input.footerText,
      buttonText: input.buttonText,
      sections: input.sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          rowId: r.id,
          title: r.title,
          description: (r.description ?? '').toString(),
        })),
      })),
      delay: input.delayMs ?? 1200,
    });
  }

  // Botões interativos (até 3 reply). Evolution API v2.4.0 —
  // `buttonsMessageSchema` / SendButtonsDto. Cada botão precisa
  // { type: 'reply', id, displayText }. `title` é o cabeçalho (bold),
  // `description` (subtítulo plain text) e `footer` opcionais.
  // 📌 v2.4.0: botões agora trafegam como `interactiveMessage` + nativeFlow
  // (não mais `buttonsMessage` legacy). Renderiza em Web/iOS/Android.
  async sendButtons(instanceName: string, input: {
    number: string;
    title: string;
    description?: string;
    footer?: string;
    buttons: { id: string; title: string }[];
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    if (input.buttons.length === 0 || input.buttons.length > 3) {
      throw new BadGatewayException('WhatsApp aceita entre 1 e 3 botões');
    }
    return this.call('POST', `/message/sendButtons/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.footer ? { footer: input.footer } : {}),
      buttons: input.buttons.map((b) => ({
        type: 'reply',
        id: b.id,
        // `title` do botão é enviado como `displayText` na Evolution v2.4.0
        // (mapeado internamente pelo `toJSONString` → { display_text, id }).
        displayText: b.title,
      })),
      delay: input.delayMs ?? 1200,
    });
  }

  async sendLocation(instanceName: string, input: {
    number: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendLocation/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      options: { delay: input.delayMs ?? 1200 },
      locationMessage: {
        latitude: input.latitude,
        longitude: input.longitude,
        degreesLatitude: input.latitude,
        degreesLongitude: input.longitude,
        ...(input.name ? { name: input.name } : {}),
        ...(input.address ? { address: input.address } : {}),
      },
    });
  }

  // 📌 M24 — Evolution API v2.4.0: schema `contactMessageSchema` mudou para
  // formato FLAT (sem wrapper `contactMessage` nem `options`). Raiz espera:
  //   { number, contact: [{ fullName, phoneNumber }], delay }
  // Em v2.3.7 o formato era `{ contactMessage:{contacts:[{fullName,phones:[...]}]} }`
  // que agora retorna HTTP 400. Cada contato usa `phoneNumber` (string única),
  // não mais `phones: [{number, type}]`. Mantemos a assinatura pública estável
  // (`input.contact = {name, phone}`) e mapeamos internamente pro novo shape.
  async sendContact(instanceName: string, input: {
    number: string;
    contact: { name: string; phone: string };
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendContact/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      contact: [
        {
          fullName: input.contact.name,
          phoneNumber: input.contact.phone,
        },
      ],
      delay: input.delayMs ?? 1200,
    });
  }

  // 📌 M24 — Evolution API v2.4.0: schema `pollMessageSchema` mudou para
  // formato FLAT (sem wrapper `pollMessage` nem `options`). Raiz espera:
  //   { number, name, values: string[], selectableCount, delay }
  // Em v2.3.7 o formato era `{ pollMessage:{name, values, selectableCount} }`
  // que agora retorna HTTP 400 com `instance requires property "values"` —
  // o validador v2.4.0 não olha dentro de `pollMessage`. Mantemos a assinatura
  // pública (`input.options` em vez de `values` p/ não confundir com other
  // options do DTO) e mapeamos internamente.
  async sendPoll(instanceName: string, input: {
    number: string;
    name: string;
    options: string[];
    selectableCount?: number;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendPoll/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      name: input.name,
      values: input.options,
      selectableCount: input.selectableCount ?? 1,
      delay: input.delayMs ?? 1200,
    });
  }

  async sendReaction(instanceName: string, input: {
    number: string;
    emoji: string;
    delayMs?: number;
  }): Promise<{ key?: { id?: string }; status?: string }> {
    return this.call('POST', `/message/sendReaction/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      options: { delay: input.delayMs ?? 1200 },
      reactionMessage: { reaction: input.emoji },
    });
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
