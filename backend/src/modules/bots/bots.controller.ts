import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BotsService } from './bots.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotDto } from './dto/update-bot.dto';
import { CreateBotTriggerDto } from './dto/create-bot-trigger.dto';
import { UpdateBotTriggerDto } from './dto/update-bot-trigger.dto';
import { CreateBotStepDto } from './dto/create-bot-step.dto';
import { UpdateBotStepDto } from './dto/update-bot-step.dto';
import { CreateBotRuleDto } from './dto/create-bot-rule.dto';
import { TestBotDto } from './dto/test-bot.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SandboxBotService } from './sandbox-bot.service';

@UseGuards(TenantGuard, RolesGuard)
@Roles('owner', 'admin')
@Controller('bots')
export class BotsController {
  constructor(
    private readonly botsService: BotsService,
    private readonly sandbox: SandboxBotService,
  ) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateBotDto) {
    return this.botsService.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.botsService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.botsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateBotDto) {
    return this.botsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.botsService.remove(tenantId, id);
  }

  // ─── Triggers ───────────────────────────────────────────────────────

  @Post(':id/triggers')
  createTrigger(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateBotTriggerDto,
  ) {
    return this.botsService.createTrigger(tenantId, id, dto);
  }

  @Patch(':id/triggers/:triggerId')
  updateTrigger(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('triggerId') triggerId: string,
    @Body() dto: UpdateBotTriggerDto,
  ) {
    return this.botsService.updateTrigger(tenantId, id, triggerId, dto);
  }

  @Delete(':id/triggers/:triggerId')
  removeTrigger(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('triggerId') triggerId: string,
  ) {
    return this.botsService.removeTrigger(tenantId, id, triggerId);
  }

  // ─── Steps ──────────────────────────────────────────────────────────

  @Post(':id/steps')
  createStep(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateBotStepDto,
  ) {
    return this.botsService.createStep(tenantId, id, dto);
  }

  @Patch(':id/steps/:stepId')
  updateStep(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateBotStepDto,
  ) {
    return this.botsService.updateStep(tenantId, id, stepId, dto);
  }

  @Delete(':id/steps/:stepId')
  removeStep(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.botsService.removeStep(tenantId, id, stepId);
  }

  // ─── Compat S24: rules + publish (legacy BotVersion) ────────────────

  @Post(':id/versions/:version/rules')
  addRule(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() dto: CreateBotRuleDto,
  ) {
    return this.botsService.addRule(tenantId, id, Number(version), dto);
  }

  @Patch(':id/versions/:version/publish')
  publish(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.botsService.publish(tenantId, id, Number(version));
  }

  // ─── Sandbox ( teste ) ─────────────────────────────────────────────

  @Post(':id/test')
  test(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: TestBotDto) {
    return this.sandbox.test(tenantId, id, dto);
  }
}
