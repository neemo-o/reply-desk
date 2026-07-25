import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { PlanLimitsService } from '../subscriptions/plan-limits.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

const DEFAULT_ROLES = [
  { name: 'owner', description: 'Acesso total ao tenant' },
  { name: 'admin', description: 'Gerencia usuários e configurações' },
  { name: 'agent', description: 'Atende conversas' },
];

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * ⚡ Invalida cache de membership do TenantGuard para um usuário neste tenant.
   * Garantia: alterações de role/remoção propagam imediatamente em vez de ≤ 60s.
   * Falha de Redis é não-fatal (cache expira naturalmente).
   */
  private async invalidateMembershipCache(userId: string, tenantId: string): Promise<void> {
    try {
      await this.redis.del(`tenant-auth:${userId}:${tenantId}`);
    } catch (err) {
      this.logger.warn(`Cache invalidation falhou: ${(err as Error).message}`);
    }
  }

  /**
   * DB-4 — Slug race condition eliminada: catch P2002 em vez de findUnique+create.
   * Normalização: slug vira lowercase + kebab-case antes de salvar.
   */
  async create(ownerId: string, dto: CreateTenantDto) {
    const slug = dto.slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.name.trim(),
            slug,
            timezone: dto.timezone ?? 'America/Sao_Paulo',
          },
        });

        const roles = await Promise.all(
          DEFAULT_ROLES.map((role) =>
            tx.role.create({ data: { ...role, tenantId: tenant.id } }),
          ),
        );

        const ownerRole = roles.find((r) => r.name === 'owner');
        if (!ownerRole) throw new NotFoundException('Role owner não foi criado');

        await tx.tenantUser.create({
          data: { tenantId: tenant.id, userId: ownerId, roleId: ownerRole.id },
        });

        return tenant;
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('Slug já utilizado');
      }
      throw err;
    }
  }

  async findMine(userId: string) {
    return this.prisma.tenant.findMany({
      where: { tenantUsers: { some: { userId, status: 'active' } } },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        status: true,
        createdAt: true,
        timezone: true,
        language: true,
      },
    });
  }

  /**
   * 🔒 Edição básica do tenant — chamado pelo controller com @Roles('owner').
   * Slug é normalizado igual ao create e validado por P2002 na catch.
   */
  async update(tenantId: string, dto: UpdateTenantDto) {
    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.logo !== undefined) data.logo = dto.logo;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.language !== undefined) data.language = dto.language;

    if (dto.slug !== undefined) {
      data.slug = dto.slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-');
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar');
    }

    try {
      return await this.prisma.tenant.update({
        where: { id: tenantId },
        data,
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          timezone: true,
          language: true,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('Slug já utilizado');
      }
      throw err;
    }
  }

  /**
   * 🔒 Cria convite para email que ainda não tem conta.
   * Não exige que o User exista — a invitation fica pendente e é resgatada
   * quando o usuário se cadastra e verifica o email.
   *
   * Regras:
   * - Se já existe TenantUser ativo com aquele email → Conflict (já é membro).
   * - Se já existe Invitation pending para aquele email neste tenant → Conflict.
   * - Se o User já existe e já é membro → Conflict.
   * - Se o User já existe mas NÃO é membro → cria TenantUser direto (aceita imediato).
   */
  async inviteUser(tenantId: string, dto: InviteUserDto, invitedBy: string) {
    // 🔒 M7 — Verifica limite de usuários do plano antes de convidar
    await this.planLimits.assertCanInviteUser(tenantId);

    const role = await this.prisma.role.findFirst({
      where: { tenantId, name: dto.roleName },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Papel (role) não encontrado neste tenant');

    const normalizedEmail = dto.email.toLowerCase();

    // Checa se o usuário já existe e já é membro deste tenant.
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.tenantUser.findFirst({
        where: { tenantId, userId: existingUser.id, status: 'active' },
        select: { id: true },
      });
      if (existingMembership) {
        throw new ConflictException('Usuário já é membro deste tenant');
      }

      // Usuário existe mas não é membro — adiciona direto.
      try {
        return await this.prisma.tenantUser.create({
          data: { tenantId, userId: existingUser.id, roleId: role.id },
          select: { id: true, tenantId: true, userId: true, status: true },
        });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
          throw new ConflictException('Usuário já é membro deste tenant');
        }
        throw err;
      }
    }

    // Usuário não existe — cria invitation pendente.
    try {
      const invitation = await this.prisma.invitation.create({
        data: {
          tenantId,
          email: normalizedEmail,
          roleName: dto.roleName,
          invitedBy,
          status: 'pending',
        },
        select: { id: true, email: true, roleName: true, status: true, createdAt: true },
      });

      // TODO: enviar email de convite via MailService quando o trail de
      // registro for implementado. Por ora, o owner compartilha o link de
      // registro manualmente.
      this.logger.log(`Convite criado para ${normalizedEmail} no tenant ${tenantId}`);

      return invitation;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('Convite já enviado para este email neste tenant');
      }
      throw err;
    }
  }

  async listInvitations(tenantId: string) {
    return this.prisma.invitation.findMany({
      where: { tenantId, status: 'pending' },
      select: { id: true, email: true, roleName: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelInvitation(tenantId: string, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, tenantId },
      select: { id: true, status: true },
    });
    if (!invitation) throw new NotFoundException('Convite não encontrado');
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Convite não está mais pendente');
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'cancelled' },
    });

    return { success: true };
  }

  async listMembers(tenantId: string) {
    return this.prisma.tenantUser.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } },
    });
  }

  /**
   * 🔒 Remove membro do tenant (soft delete — status = 'removed').
   *
   * Regras:
   * - Owner pode remover qualquer um, inclusive outro owner.
   * - Admin pode remover agents, mas NÃO pode remover owners nem outros admins.
   * - Ninguém pode remover o último owner restante (impede tenant órfão).
   * - Self-removal é permitido desde que não seja o último owner.
   *
   * @param actingRole  role de quem chama ('owner' | 'admin')
   * @param actingUserId  id do usuário que faz a ação
   */
  async removeMember(
    tenantId: string,
    memberTenantUserId: string,
    actingRole: string,
    actingUserId: string,
  ) {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { id: memberTenantUserId, tenantId },
      select: { id: true, userId: true, roleId: true, role: { select: { name: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Membro não encontrado neste tenant');
    }

    const targetRoleName = membership.role.name;
    const isSelf = membership.userId === actingUserId;

    // Admin não remove owner nem outro admin.
    if (actingRole === 'admin' && (targetRoleName === 'owner' || targetRoleName === 'admin')) {
      throw new ForbiddenException('Administradores não podem remover owners nem outros administradores');
    }

    // Não pode remover o último owner.
    if (targetRoleName === 'owner') {
      const ownerCount = await this.prisma.tenantUser.count({
        where: { tenantId, role: { name: 'owner' }, status: 'active' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Não é possível remover o único owner da organização. Transfira o ownership antes.',
        );
      }
    }

    await this.prisma.tenantUser.update({
      where: { id: memberTenantUserId },
      data: { status: 'removed' },
    });

    // ⚡ Invalida cache de membership do usuário removido.
    await this.invalidateMembershipCache(membership.userId, tenantId);

    return { success: true, isSelf };
  }

  /**
   * 🔒 Altera a role de um membro.
   *
   * Regras:
   * - Owner pode promover/rebaixar qualquer um (inclusive a/a partir de owner).
   * - Admin pode apenas entre admin↔agent (não pode criar/retirar owners).
   * - Não pode rebaixar o último owner (eguarda ≥1 owner sempre).
   * - 🔒 M17 — Não pode promover um SEGUNDO owner: só pode existir 1 owner por
   *   tenant. A troca de owner deve passar pela transferência de ownership
   *   (POST /tenants/transfer-ownership), que é atômica e rebaixa o dono atual.
   * - Self-rebaixamento de owner é bloqueado se for o único.
   *
   * @param actingRole  role de quem chama ('owner' | 'admin')
   * @param actingUserId  id do usuário que faz a ação
   */
  async updateMemberRole(
    tenantId: string,
    memberTenantUserId: string,
    dto: UpdateMemberRoleDto,
    actingRole: string,
    actingUserId: string,
  ) {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { id: memberTenantUserId, tenantId },
      select: { id: true, userId: true, roleId: true, role: { select: { name: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Membro não encontrado neste tenant');
    }

    const currentRoleName = membership.role.name;

    // Sem mudança — no-op explícito.
    if (currentRoleName === dto.roleName) {
      return { success: true, noChange: true };
    }

    // Admin não pode criar/retirar owners.
    if (actingRole === 'admin' && (dto.roleName === 'owner' || currentRoleName === 'owner')) {
      throw new ForbiddenException('Administradores não podem promover ou rebaixar owners');
    }

    // 🔒 M17 — Bloqueia promoção a um segundo owner. Só pode existir 1 owner:
    // a troca de dono é feita pela transferência de ownership (atómica).
    if (dto.roleName === 'owner' && currentRoleName !== 'owner') {
      const ownerCount = await this.prisma.tenantUser.count({
        where: { tenantId, role: { name: 'owner' }, status: 'active' },
      });
      if (ownerCount >= 1) {
        throw new BadRequestException(
          'Já existe um dono nesta organização. Use a transferência de ownership para trocar o dono.',
        );
      }
    }

    // Guarda último owner: se está rebaixando um owner (owner → admin/agent),
    // precisa ter ≥2 owners ativos após a operação.
    if (currentRoleName === 'owner' && dto.roleName !== 'owner') {
      const ownerCount = await this.prisma.tenantUser.count({
        where: { tenantId, role: { name: 'owner' }, status: 'active' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Não é possível rebaixar o único owner da organização. Transfira o ownership antes.',
        );
      }
    }

    const newRole = await this.prisma.role.findFirst({
      where: { tenantId, name: dto.roleName },
      select: { id: true },
    });
    if (!newRole) throw new NotFoundException('Role de destino não encontrada neste tenant');

    await this.prisma.tenantUser.update({
      where: { id: memberTenantUserId },
      data: { roleId: newRole.id },
    });

    // ⚡ Invalida cache de membership do usuário afetado.
    await this.invalidateMembershipCache(membership.userId, tenantId);

    return { success: true };
  }

  /**
   * 🔒 M17 — Transfere ownership do tenant de forma atômica.
   *
   * O dono atual (identificado por `actingUserId`) é rebaixado a admin e o
   * membro alvo (`newOwnerTenantUserId`) é promovido a owner, numa transação.
   *
   * Regras:
   * - Só o owner atual pode transferir (guard @Roles('owner') no controller).
   * - O alvo precisa ser membro ativo do mesmo tenant.
   * - O alvo não pode já ser owner (no-op explícito).
   * - Não pode transferir para si mesmo.
   * - Invalida cache de membership de ambos os envolvidos.
   *
   * @param actingUserId  id do usuário que faz a ação (deve ser o owner atual)
   */
  async transferOwnership(tenantId: string, newOwnerTenantUserId: string, actingUserId: string) {
    // Valida o alvo.
    const target = await this.prisma.tenantUser.findFirst({
      where: { id: newOwnerTenantUserId, tenantId, status: 'active' },
      select: { id: true, userId: true, roleId: true, role: { select: { name: true } } },
    });
    if (!target) {
      throw new NotFoundException('Membro de destino não encontrado neste tenant');
    }

    // Não pode transferir para si mesmo.
    if (target.userId === actingUserId) {
      throw new BadRequestException('Você já é o dono desta organização');
    }

    // No-op se o alvo já é owner.
    if (target.role.name === 'owner') {
      return { success: true, noChange: true };
    }

    // Busca o owner atual (o solicitante) e valida que é owner.
    const currentOwner = await this.prisma.tenantUser.findFirst({
      where: { tenantId, userId: actingUserId, status: 'active' },
      select: { id: true, roleId: true, role: { select: { name: true } } },
    });
    if (!currentOwner || currentOwner.role.name !== 'owner') {
      throw new ForbiddenException('Apenas o dono pode transferir a propriedade da organização');
    }

    // Busca as roles owner e admin deste tenant.
    const [ownerRole, adminRole] = await Promise.all([
      this.prisma.role.findFirst({ where: { tenantId, name: 'owner' }, select: { id: true } }),
      this.prisma.role.findFirst({ where: { tenantId, name: 'admin' }, select: { id: true } }),
    ]);
    if (!ownerRole || !adminRole) {
      throw new NotFoundException('Roles owner/admin não encontradas neste tenant');
    }

    // Transação atômica: rebaixa o owner atual → admin, promove o alvo → owner.
    await this.prisma.$transaction([
      this.prisma.tenantUser.update({
        where: { id: currentOwner.id },
        data: { roleId: adminRole.id },
      }),
      this.prisma.tenantUser.update({
        where: { id: target.id },
        data: { roleId: ownerRole.id },
      }),
    ]);

    // ⚡ Invalida cache de membership de ambos para o TenantGuard refletir
    // as novas roles imediatamente.
    await Promise.all([
      this.invalidateMembershipCache(actingUserId, tenantId),
      this.invalidateMembershipCache(target.userId, tenantId),
    ]);

    return { success: true };
  }
}
