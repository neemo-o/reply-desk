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
   *
   * 🔒 Bug 6 — Regras por tipo:
   *   - Basic: até 1 bot de cada tipo (SIMPLE, AGENTS, AUTO).
   *   - Premium: até 3 bots de cada tipo.
   *   - Ambos: `maxBots` + `maxActiveBots` (total ativos simultâneos).
   *
   * @param type Tipo do bot sendo criado (SIMPLE, AGENTS, AUTO).
   * @param checkActive  Se true, também valida o limite de bots ativos
   *                     (caller deve passar false para check passivo).
   */
  async assertCanCreateBot(tenantId: string, type: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan) return;

    // ✅ Limite POR TIPO: conta bots existentes do MESMO tipo.
    const typeCount = await this.prisma.bot.count({
      where: { tenantId, type },
    });
    const maxPerType = plan.maxBotsPerType ?? 1;
    if (typeCount >= maxPerType) {
      throw new ForbiddenException(
        `Limite de bots de tipo "${type}" do plano ${plan.name} atingido ` +
        `(${maxPerType}). Faça upgrade para criar mais bots desse tipo.`,
      );
    }

    // ✅ Limite total de bots
    const botCount = await this.prisma.bot.count({
      where: { tenantId },
    });
    if (botCount >= plan.maxBots) {
      throw new ForbiddenException(
        `Limite total de bots do plano ${plan.name} atingido (${plan.maxBots}). ` +
          `Faça upgrade do plano para adicionar mais bots.`,
      );
    }

    // ✅ Limite de bots ATIVOS (status='active'). Verificação pós-criação é
    // responsabilidade do BotsService que chama `assertCanActivateBot()`.
  }

  /**
   * 🔒 Bug 6 — Verifica se o tenant pode ativar mais um bot (status → active).
   *
   * Chamado pelo BotsService.update() quando o status muda para 'active'.
   * Conta bots que já estão com status='active' OU 'testing' e compara com
   * maxActiveBots. Bots em testing também contam contra o limite, pois são
   * tratados como ativos (escopo limitado a `testContactPhone`, mas em
   * funcionamento real).
   *
   * @param excludeBotId Ignora este bot na contagem (para quando se está
   *                      re-ativando um bot que já era active).
   */
  async assertCanActivateBot(tenantId: string, excludeBotId?: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan) return;

    const [activeCount] = await Promise.all([
      this.prisma.bot.count({
        where: { tenantId, status: { in: ['active', 'testing'] } },
      }),
    ]);

    // Se o bot que estamos ativando já era active/testing (re-ativação), ele
    // não conta contra o limite — subtrai se excludeBotId foi informado.
    const effectiveCount = excludeBotId
      ? await this.prisma.bot.count({
          where: { tenantId, status: { in: ['active', 'testing'] }, NOT: { id: excludeBotId } },
        })
      : activeCount;

    const maxActive = plan.maxActiveBots ?? 1;
    if (effectiveCount >= maxActive) {
      throw new ForbiddenException(
        `Limite de bots ativos do plano ${plan.name} atingido ` +
        `(${maxActive}). Desative outro bot antes de ativar este.`
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
