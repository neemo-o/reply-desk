import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

/**
 * 📊 WebhookMetricsService — contadores in-memory de webhooks da Evolution
 * API rejeitados, com logging estruturado para auditoria de segurança.
 *
 * Resolve o problema #21 do relatório de QR/conexão:
 * `EvolutionWebhookController` rejeitava assinaturas inválidas apenas com
 * `Logger.warn` sem diferenciar motivos e sem métrica agregada, dificultando
 * detectar spikes de tentativas (possível ataque / Evolution desconfigurada).
 *
 * Estratégia (sem adicionar dependência de Prometheus):
 *  - HashMap em memória por `reason` AWS-like: missing_instance,
 *    missing_signature, unknown_session, invalid_signature.
 *  - Cada `inc()` loga estruturado (pino) com `reason` + `instanceName`,
 *    permitindo query/aggregation em Datadog/Loki/CloudWatch.
 *  - A cada um minuto (janela deslizante), resume o período em `log`
 *    com `periodTotal` e zera os contadores — útil para detectar spikes
 *    sem inflar log indefinidamente.
 *  - `snapshot()` expõe o estado atual para um eventual endpoint
 *    administrativo de observabilidade (a adicionar quando houver um
 *    guard de role + auditoria; não exposto neste commit).
 *
 * Notas:
 *  - Em deploy multi-réplica, cada réplica tem seus contadores; agregação
 *    deve considerar isso (somar via Datadog metric por host).
 *  - Não persistente: perde em restart (aceitável para métrica short-lived).
 */
export type WebhookRejectionReason =
  | 'missing_instance'
  | 'missing_signature'
  | 'unknown_session'
  | 'invalid_signature';

const SUMMARY_INTERVAL_MS = 60_000;

@Injectable()
export class WebhookMetricsService implements OnModuleDestroy {
  private readonly logger = new Logger('WebhookMetrics');
  private readonly counters = new Map<WebhookRejectionReason, number>();
  private readonly summaryTimer: NodeJS.Timeout;

  constructor() {
    for (const r of [
      'missing_instance',
      'missing_signature',
      'unknown_session',
      'invalid_signature',
    ] as WebhookRejectionReason[]) {
      this.counters.set(r, 0);
    }

    this.summaryTimer = setInterval(() => this.summarize(), SUMMARY_INTERVAL_MS);
    this.summaryTimer.unref?.();
  }

  /**
   * Incrementa o contador `reason` e loga estruturado.
   * `instanceName` é logado sem revelar a assinatura recebida.
   */
  inc(reason: WebhookRejectionReason, instanceName?: string): void {
    this.counters.set(reason, (this.counters.get(reason) ?? 0) + 1);

    this.logger.warn(
      `webhook.rejected reason=${reason} instance="${
        instanceName ?? '-'
      }"`,
    );
  }

  /** Snapshot imutível — útil para eventual endpoint de observabilidade. */
  snapshot(): Record<WebhookRejectionReason, number> {
    return {
      missing_instance: this.counters.get('missing_instance') ?? 0,
      missing_signature: this.counters.get('missing_signature') ?? 0,
      unknown_session: this.counters.get('unknown_session') ?? 0,
      invalid_signature: this.counters.get('invalid_signature') ?? 0,
    };
  }

  /**
   * Sumariza a janela atual em um único log e reseta contadores.
   * Chamada automaticamente a cada SUMMARY_INTERVAL_MS.
   */
  private summarize(): void {
    const snapshot = this.snapshot();
    const periodTotal =
      snapshot.missing_instance +
      snapshot.missing_signature +
      snapshot.unknown_session +
      snapshot.invalid_signature;
    if (periodTotal === 0) return; // não loga janelas vazias
    this.logger.warn(
      `webhook.rejected.summary periodMs=${SUMMARY_INTERVAL_MS} total=${periodTotal} ` +
        `missing_instance=${snapshot.missing_instance} ` +
        `missing_signature=${snapshot.missing_signature} ` +
        `unknown_session=${snapshot.unknown_session} ` +
        `invalid_signature=${snapshot.invalid_signature}`,
    );
    for (const r of this.counters.keys()) this.counters.set(r, 0);
  }

  /** Limpa o timer ao destruir o módulo (testes / shutdown). */
  onModuleDestroy(): void {
    clearInterval(this.summaryTimer);
  }
}
