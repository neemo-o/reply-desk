import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isUuid } from '../utils/security';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_SUBSCRIPTION_KEY } from '../decorators/skip-subscription.decorator';

/**
 * ⚡ P2 — TenantGuard com cache de membership via Redis.
 *
 * Agora global (APP_GUARD em AppModule), registrado ANTES do
 * SubscriptionGuard. Popula request.tenantId + request.user.tenantId/role
 * para que guards downstream (SubscriptionGuard) possam validar a
 * assinatura do tenant.
 *
 * Rotas @Public() pulam membership (não há usuário autenticado).
 *
 * 🔒 Rotas @SkipSubscription() NÃO pulam membership — apenas tornam o
 * header x-tenant-id **opcional**. Se o header estiver presente, populamos
 * role/tenantId normalmente (necessário para @Roles(...)) e o SubscriptionGuard
 * depois pula a verificação de assinatura. Se o header NÃO estiver presente
 * (ex: /auth/me antes de o usuário ter tenant), permitimos o fluxo sem popular
 * nada — nenhuma rota @SkipSubscription() usa @Roles() nesse caminho.
 *
 * Bug histórico: antes o TenantGuard tratava @SkipSubscription() como
 * "pular membership totalmente" — return true imediato. Combinado com
 * @UseGuards(TenantGuard, RolesGuard) em SubscriptionsController e
 * TenantsController, isso deixava request.user.role === undefined →
 * RolesGuard sempre rejeitava com 403 "Permissão insuficiente para este
 * recurso", mesmo para usuários legítimos com role 'owner'.
 *
 * Cache Redis TTL 60s — alterações em membership propagam em ≤ 60s.
 */
const CACHE_TTL_SEC = 60;

interface CachedMembership {
  role: string;
  roleId: string;
}

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() routes — sem usuário, sem verificação de tenant
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // @SkipSubscription() routes — NÃO pulam membership; tornam o header
    // x-tenant-id opcional. Sem header, deixamos o fluxo seguir sem popular
    // role/tenantId (o SubscriptionGuard vai pular a verificação de assinatura
    // de qualquer forma). Com header, populamos normalmente para que @Roles(...)
    // funcione — ver comentário no topo do arquivo.
    const skipSubscription = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const rawTenantId = request.headers['x-tenant-id'];

    // Sem header e rota exige membership (não é skip) — bloqueia.
    const hasHeader = typeof rawTenantId === 'string' && rawTenantId.trim() !== '';
    if (!hasHeader && !skipSubscription) {
      throw new BadRequestException('Header x-tenant-id é obrigatório');
    }

    // Sem header e rota @SkipSubscription() — segue sem popular nada.
    if (!hasHeader) {
      return true;
    }

    const tenantId = rawTenantId.trim();
    if (!isUuid(tenantId)) {
      throw new BadRequestException('Header x-tenant-id inválido');
    }

    const user = request.user;
    if (!user?.sub || !isUuid(user.sub)) {
      throw new ForbiddenException('Sessão inválida');
    }

    const cacheKey = `tenant-auth:${user.sub}:${tenantId}`;
    let cached: CachedMembership | null = null;

    try {
      const raw = await this.redis.get(cacheKey);
      if (raw) cached = JSON.parse(raw) as CachedMembership;
    } catch (err) {
      this.logger.warn(`Cache read falhou: ${(err as Error).message}`);
    }

    if (cached) {
      request.tenantId = tenantId;
      request.user.tenantId = tenantId;
      request.user.role = cached.role;
      request.user.roleId = cached.roleId;
      return true;
    }

    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: { tenantId, userId: user.sub, status: 'active' },
      select: {
        id: true,
        roleId: true,
        role: { select: { name: true } },
      },
    });

    if (!tenantUser) {
      throw new ForbiddenException('Usuário não pertence a este tenant');
    }

    const membership: CachedMembership = {
      role: tenantUser.role.name,
      roleId: tenantUser.roleId,
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(membership), 'EX', CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn(`Cache write falhou: ${(err as Error).message}`);
    }

    request.tenantId = tenantId;
    request.user.tenantId = tenantId;
    request.user.role = membership.role;
    request.user.roleId = membership.roleId;

    return true;
  }
}
