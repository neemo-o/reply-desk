import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@UseGuards(TenantGuard, RolesGuard)
@Roles('owner', 'admin')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly service: BroadcastsService) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateBroadcastDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id/progress')
  getProgress(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getProgress(tenantId, id);
  }

  @Patch(':id/pause')
  pause(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.pause(tenantId, id);
  }

  @Patch(':id/resume')
  resume(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.resume(tenantId, id);
  }
}
