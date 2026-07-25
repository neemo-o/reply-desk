import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ForbiddenException, Req } from '@nestjs/common';
import { SkipSubscription } from '../../common/decorators/skip-subscription.decorator';
import type { Request } from 'express';

/**
 * 🔒 M6 — @SkipSubscription(): criar/listar tenants não requer assinatura ativa.
 * O usuário pode precisar criar um novo tenant APÓS o anterior ser bloqueado.
 */
@SkipSubscription()
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly prisma: PrismaService,
  ) {}

  // 🔒 M3 — Rate limiting apertado: 3 tenants/min por usuário (previne abuso)
  // 🔒 M4 — Valida email verificado antes de permitir criar tenant
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateTenantDto) {
    // M4 — Verifica se o email do usuário está verificado
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    if (!user) throw new ForbiddenException('Usuário não encontrado');
    if (!user.emailVerified) {
      throw new ForbiddenException('Confirme seu e-mail antes de criar uma organização');
    }

    // M1 — Bloqueia criação de múltiplos tenants (o tenant inicial já é criado
    // automaticamente após verificação de email; este endpoint é para edge cases
    // como usuários que querem um segundo tenant ou recriar após deletion)
    const existingTenants = await this.prisma.tenantUser.count({
      where: { userId, status: 'active' },
    });
    if (existingTenants >= 1) {
      throw new ForbiddenException('Você já possui uma organização. Contate o suporte para múltiplas organizações.');
    }

    return this.tenantsService.create(userId, dto);
  }

  @Get('mine')
  findMine(@CurrentUser('sub') userId: string) {
    return this.tenantsService.findMine(userId);
  }

  /**
   * 🔒 Edição básica do tenant — owner only.
   * Atualiza name, slug, logo, timezone, language.
   */
  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner')
  @Patch()
  update(@CurrentTenant() tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(tenantId, dto);
  }

  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  @Post('members')
  invite(@CurrentTenant() tenantId: string, @Body() dto: InviteUserDto) {
    return this.tenantsService.inviteUser(tenantId, dto);
  }

  @UseGuards(TenantGuard)
  @Get('members')
  listMembers(@CurrentTenant() tenantId: string) {
    return this.tenantsService.listMembers(tenantId);
  }

  /**
   * 🔒 Remove membro — owner+admin.
   * Admin não remove owner/admin; owner não remove último owner restante.
   */
  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  @Delete('members/:id')
  removeMember(
    @CurrentTenant() tenantId: string,
    @Param('id') memberTenantUserId: string,
    @Req() req: Request,
  ) {
    const actingRole = (req.user as { role?: string }).role ?? '';
    const actingUserId = (req.user as { sub?: string }).sub ?? '';
    return this.tenantsService.removeMember(tenantId, memberTenantUserId, actingRole, actingUserId);
  }

  /**
   * 🔒 Altera role de membro — owner+admin.
   * Admin não pode promover/rebaixar owners; último owner não pode ser rebaixado.
   */
  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  @Patch('members/:id')
  updateMemberRole(
    @CurrentTenant() tenantId: string,
    @Param('id') memberTenantUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    const actingRole = (req.user as { role?: string }).role ?? '';
    const actingUserId = (req.user as { sub?: string }).sub ?? '';
    return this.tenantsService.updateMemberRole(
      tenantId,
      memberTenantUserId,
      dto,
      actingRole,
      actingUserId,
    );
  }
}
