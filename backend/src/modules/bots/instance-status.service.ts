import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EvolutionService } from '../../common/evolution/evolution.service';

export interface InstanceStatusResponse {
  /// status agregado: connected | disconnected | partial | unknown
  status: 'connected' | 'disconnected' | 'partial' | 'unknown';
  /// detalhe por sessão do tenant.
  sessions: {
    id: string;
    name: string;
    sessionName: string;
    phone: string | null;
    profileName: string | null;
    /// status persistido no DB (disconnected | connecting | connected | …).
    persistedStatus: string;
    /// estado ao vivo consultado na Evolution API (pode divergir em race).
    liveState: string | null;
    /// true se a Evolution API reportou state=open.
    isConnected: boolean;
  }[];
  updatedAt: string;
}

/**
 * 📡 InstanceStatusService — status agregado das instâncias WhatsApp do tenant.
 * Consulta o DB (WhatsappSession + SessionEvent) e a Evolution em tempo real.
 *
 * Em caso de falha da Evolution API, retornamos `unknown` mas ainda assim
 * listamos as sessões com status persistido — assim o frontend consegue
 * exibir infra e o realtime via WebSocket pode avisar queda.
 */
@Injectable()
export class InstanceStatusService {
  private readonly logger = new Logger(InstanceStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
  ) {}

  async getStatus(tenantId: string): Promise<InstanceStatusResponse> {
    const sessions = await this.prisma.whatsappSession.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        sessionName: true,
        phone: true,
        profileName: true,
        status: true,
      },
    });

    if (sessions.length === 0) {
      return { status: 'unknown', sessions: [], updatedAt: new Date().toISOString() };
    }

    const detailed = await Promise.all(
      sessions.map(async (s) => {
        let liveState: string | null = null;
        try {
          const fetched = await this.evolution.fetchInstance(s.sessionName);
          const data = (fetched ?? {}) as Record<string, unknown>;
          const instance = data.instance as Record<string, unknown> | undefined;
          liveState =
            (instance?.state as string | undefined) ??
            (instance?.connection as string | undefined) ??
            null;
        } catch (err) {
          this.logger.debug(
            `fetchInstance(${s.sessionName}) falhou: ${(err as Error).message}`,
          );
        }
        const isConnected = liveState?.toLowerCase() === 'open' || s.status === 'connected';
        return {
          id: s.id,
          name: s.name,
          sessionName: s.sessionName,
          phone: s.phone,
          profileName: s.profileName,
          persistedStatus: s.status,
          liveState,
          isConnected,
        };
      }),
    );

    const connectedCount = detailed.filter((d) => d.isConnected).length;
    let status: InstanceStatusResponse['status'];
    if (connectedCount === sessions.length) status = 'connected';
    else if (connectedCount === 0) status = 'disconnected';
    else status = 'partial';

    return {
      status,
      sessions: detailed,
      updatedAt: new Date().toISOString(),
    };
  }
}
