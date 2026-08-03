import { Controller, Get, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EvolutionService } from '../../common/evolution/evolution.service';
import { InstanceStatusService } from './instance-status.service';

/**
 * 📡 Status da instância WhatsApp conectada ao tenant.
 * Combina dados do DB (sessões + status persistido) com consulta ao vivo
 * na Evolution API (mesma instância).
 */
@UseGuards(TenantGuard, RolesGuard)
@Roles('owner', 'admin')
@Controller('instance')
export class InstanceController {
  constructor(private readonly statusService: InstanceStatusService) {}

  @Get('status')
  status(@CurrentTenant() tenantId: string) {
    return this.statusService.getStatus(tenantId);
  }
}
