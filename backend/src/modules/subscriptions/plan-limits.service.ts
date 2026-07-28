import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 🔒 M7/M8 — Enforcement de limites do plano.
 *
 * Verifica se o tenant está dentro dos limites do plano atual antes de permitir
 * criar novos recursos (sessions, bots, usuários, contatos via invite).
 *
 * 🔒 M8 — Bloqueia downgrade se os recursos ativos excederem o limite do novo
 * plano. Ex: se tem 5 sessions e quer fazer downgrade para Basic (maxSessions=3),
 * o upgrade é bloqueado com mensagem instruindo o usuário a remover recursos.
 */
@Injectable()
export class PlanLimitsService {
  private readonly logger = new Logger(PlanLimitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca o plano ativo do tenant. Retorna null se não tem assinatura ativa.
   */
  private async getActivePlan(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['active', 'trialing'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) return null;
    return subscription.plan;
  }

  /**
   * Verifica se o tenant pode criar uma nova WhatsappSession.
   *
   * 🔒 S23 — O limite maxSessions agora conta o TOTAL de sessões criadas
   * pelo tenant (não apenas as "ativas" status != disconnected). Assim um
   * Basic (maxSessions=1) só pode ter 1 sessão no total — conectada ou
   * desconectada — e precisa excluir para criar outra. Antes o usuário
   * conseguia criar infinitas sessões (só contava as conectadas), o que
   * violava a intenção do limite por plano.
   */
  async assertCanCreateSession(tenantId: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan) return; // sem assinatura = SubscriptionGuard já bloqueou

    const totalSessions = await this.prisma.whatsappSession.count({
      where: { tenantId },
    });

    if (totalSessions >= plan.maxSessions) {
      throw new ForbiddenException(
        `Limite de sessões do plano ${plan.name} atingido (${plan.maxSessions}). ` +
          `Exclua uma sessão existente ou faça upgrade do plano para criar mais sessões.`,
      );
    }
  }

  /**
   * Verifica se o tenant pode criar um novo Bot.
   */
  async assertCanCreateBot(tenantId: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan) return;

    const botCount = await this.prisma.bot.count({
      where: { tenantId },
    });

    if (botCount >= plan.maxBots) {
      throw new ForbiddenException(
        `Limite de bots do plano ${plan.name} atingido (${plan.maxBots}). ` +
          `Faça upgrade do plano para adicionar mais bots.`,
      );
    }
  }

  /**
   * Verifica se o tenant pode convidar um novo usuário (membro).
   */
  async assertCanInviteUser(tenantId: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan) return;

    const userCount = await this.prisma.tenantUser.count({
      where: { tenantId, status: 'active' },
    });

    if (userCount >= plan.maxUsers) {
      throw new ForbiddenException(
        `Limite de usuários do plano ${plan.name} atingido (${plan.maxUsers}). ` +
          `Faça upgrade do plano para adicionar mais usuários.`,
      );
    }
  }

  /**
   * 🔒 M8 — Valida se o tenant pode fazer downgrade para o novo plano.
   * Compara os recursos ativos com os limites do plano destino.
   * Se exceder, retorna lista de recursos que precisam ser removidos.
   */
  async assertCanDowngrade(
    tenantId: string,
    newPlanId: string,
  ): Promise<void> {
    const newPlan = await this.prisma.plan.findUnique({
      where: { id: newPlanId },
    });
    if (!newPlan) throw new BadRequestException('Plano não encontrado');

    // Conta recursos (🔒 S23: sessões = total criadas, não só ativas)
    const [totalSessions, botCount, userCount] = await Promise.all([
      this.prisma.whatsappSession.count({
        where: { tenantId },
      }),
      this.prisma.bot.count({ where: { tenantId } }),
      this.prisma.tenantUser.count({
        where: { tenantId, status: 'active' },
      }),
    ]);

    const violations: string[] = [];

    if (totalSessions > newPlan.maxSessions) {
      violations.push(
        `${totalSessions} sessões criadas excedem o limite do plano ${newPlan.name} (${newPlan.maxSessions}). ` +
          `Exclua ${totalSessions - newPlan.maxSessions} sessão(ões) antes de fazer o downgrade.`,
      );
    }

    if (botCount > newPlan.maxBots) {
      violations.push(
        `${botCount} bots excedem o limite do plano ${newPlan.name} (${newPlan.maxBots}). ` +
          `Remova ${botCount - newPlan.maxBots} bot(s) antes de fazer o downgrade.`,
      );
    }

    if (userCount > newPlan.maxUsers) {
      violations.push(
        `${userCount} usuários ativos excedem o limite do plano ${newPlan.name} (${newPlan.maxUsers}). ` +
          `Remova ${userCount - newPlan.maxUsers} usuário(s) antes de fazer o downgrade.`,
      );
    }

    if (violations.length > 0) {
      throw new ForbiddenException({
        message: `Não é possível fazer downgrade para o plano ${newPlan.name}. ` +
          `Recursos ativos excedem os limites do plano destino.`,
        violations,
      });
    }
  }
}
