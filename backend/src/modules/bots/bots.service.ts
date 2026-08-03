import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlanLimitsService } from '../subscriptions/plan-limits.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotDto } from './dto/update-bot.dto';
import { CreateBotTriggerDto } from './dto/create-bot-trigger.dto';
import { UpdateBotTriggerDto } from './dto/update-bot-trigger.dto';
import { CreateBotStepDto } from './dto/create-bot-step.dto';
import { UpdateBotStepDto } from './dto/update-bot-step.dto';
import { CreateBotRuleDto } from './dto/create-bot-rule.dto';
import { validateStepContent } from './broadcast/step-content.validator';
import { isUuid } from '../../common/utils/security';

@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  // ─── Bots ────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateBotDto) {
    await this.planLimits.assertCanCreateBot(tenantId);
    return this.prisma.$transaction(async (tx) => {
      const bot = await tx.bot.create({
        data: { tenantId, name: dto.name, description: dto.description, type: dto.type },
      });
      // mantém compat com S24 (versão 1 publicada p/ BROADCAST também).
      await tx.botVersion.create({ data: { botId: bot.id, version: 1 } });
      return bot;
    });
  }

  findAll(tenantId: string) {
    return this.prisma.bot.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        status: true,
        defaultVersion: true,
        updatedAt: true,
        createdAt: true,
        versions: {
          where: { published: true },
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, version: true, published: true },
        },
        triggers: { select: { id: true, tipo: true, valor: true } },
        _count: {
          select: {
            sessions: { where: { status: 'active' } },
            broadcasts: true,
          },
        },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id, tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: {
            rules: { orderBy: { priority: 'desc' } },
            variables: true,
          },
        },
        triggers: { orderBy: { createdAt: 'asc' } },
        steps: { orderBy: { ordem: 'asc' } },
      },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');
    return bot;
  }

  async update(tenantId: string, id: string, dto: UpdateBotDto) {
    const bot = await this.findOne(tenantId, id);
    if (dto.status && !['draft', 'active', 'inactive'].includes(dto.status)) {
      throw new BadRequestException('status inválido');
    }
    return this.prisma.bot.update({
      where: { id: bot.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const bot = await this.findOne(tenantId, id);
    await this.prisma.bot.delete({ where: { id: bot.id } });
    return { success: true };
  }

  // ─── Triggers ───────────────────────────────────────────────────────

  async createTrigger(tenantId: string, botId: string, dto: CreateBotTriggerDto) {
    const bot = await this.assertConventionalBot(tenantId, botId);
    if (dto.tipo === 'keyword' && (!dto.valor || dto.valor.trim().length === 0)) {
      throw new BadRequestException('valor obrigatório quando tipo=keyword');
    }
    return this.prisma.botTrigger.create({
      data: {
        botId: bot.id,
        tipo: dto.tipo,
        valor: dto.tipo === 'keyword' ? dto.valor : null,
      },
    });
  }

  async updateTrigger(tenantId: string, botId: string, triggerId: string, dto: UpdateBotTriggerDto) {
    await this.assertConventionalBot(tenantId, botId);
    const trigger = await this.prisma.botTrigger.findFirst({
      where: { id: triggerId, botId },
    });
    if (!trigger) throw new NotFoundException('Trigger não encontrado');
    if (dto.tipo === 'keyword' && dto.valor !== undefined && dto.valor.trim().length === 0) {
      throw new BadRequestException('valor obrigatório quando tipo=keyword');
    }
    const data: { tipo?: string; valor?: string | null } = {};
    if (dto.tipo !== undefined) data.tipo = dto.tipo;
    if (dto.valor !== undefined) data.valor = dto.tipo === 'first_message' ? null : dto.valor;
    if (dto.tipo === 'first_message') data.valor = null;
    return this.prisma.botTrigger.update({ where: { id: trigger.id }, data });
  }

  async removeTrigger(tenantId: string, botId: string, triggerId: string) {
    await this.assertConventionalBot(tenantId, botId);
    const trigger = await this.prisma.botTrigger.findFirst({
      where: { id: triggerId, botId },
      select: { id: true },
    });
    if (!trigger) throw new NotFoundException('Trigger não encontrado');
    await this.prisma.botTrigger.delete({ where: { id: trigger.id } });
    return { success: true };
  }

  // ─── Steps ──────────────────────────────────────────────────────────

  async createStep(tenantId: string, botId: string, dto: CreateBotStepDto) {
    const bot = await this.assertConventionalBot(tenantId, botId);
    // valida conteúdo e devolve objeto tipado (mantém no DB como JSON canônico).
    const validated = validateStepContent(dto.tipoMensagem, dto.conteudo);
    const existing = await this.prisma.botStep.findFirst({
      where: { botId: bot.id, ordem: dto.ordem },
      select: { id: true },
    });
    if (existing) throw new BadRequestException(`Já existe step com ordem ${dto.ordem}`);
    return this.prisma.botStep.create({
      data: {
        botId: bot.id,
        ordem: dto.ordem,
        tipoMensagem: dto.tipoMensagem,
        conteudo: validated as unknown as Prisma.InputJsonValue,
        condicoesProximo:
          (dto.condicoesProximo as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        fallbackStepOrder: dto.fallbackStepOrder ?? null,
      },
    });
  }

  async updateStep(tenantId: string, botId: string, stepId: string, dto: UpdateBotStepDto) {
    await this.assertConventionalBot(tenantId, botId);
    const step = await this.prisma.botStep.findFirst({
      where: { id: stepId, botId },
    });
    if (!step) throw new NotFoundException('Step não encontrado');

    if (dto.ordem !== undefined) {
      const clash = await this.prisma.botStep.findFirst({
        where: { botId, ordem: dto.ordem, NOT: { id: step.id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`Já existe outro step com ordem ${dto.ordem}`);
    }
    const validated =
      dto.tipoMensagem && dto.conteudo
        ? validateStepContent(dto.tipoMensagem, dto.conteudo)
        : undefined;

    return this.prisma.botStep.update({
      where: { id: step.id },
      data: {
        ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
        ...(dto.tipoMensagem !== undefined ? { tipoMensagem: dto.tipoMensagem } : {}),
        ...(validated
          ? { conteudo: validated as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.condicoesProximo !== undefined
          ? {
              condicoesProximo:
                (dto.condicoesProximo as unknown as Prisma.InputJsonValue) ??
                Prisma.JsonNull,
            }
          : {}),
        ...(dto.fallbackStepOrder !== undefined ? { fallbackStepOrder: dto.fallbackStepOrder } : {}),
      },
    });
  }

  async removeStep(tenantId: string, botId: string, stepId: string) {
    await this.assertConventionalBot(tenantId, botId);
    const step = await this.prisma.botStep.findFirst({
      where: { id: stepId, botId },
      select: { id: true },
    });
    if (!step) throw new NotFoundException('Step não encontrado');
    await this.prisma.botStep.delete({ where: { id: step.id } });
    return { success: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /** Bot convencional pertence ao tenant. Não permite actions em BROADCAST bots. */
  async assertConventionalBot(tenantId: string, botId: string) {
    if (!isUuid(botId)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, tenantId },
      select: { id: true, type: true },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');
    if (bot.type !== 'CONVENTIONAL') {
      throw new BadRequestException('Operação válida apenas para bots convencionais');
    }
    return bot;
  }

  // ─── Compat S24: BotVersion/Rule legacy ──────────────────────────────

  async addRule(tenantId: string, botId: string, versionNumber: number, dto: CreateBotRuleDto) {
    await this.findOne(tenantId, botId);
    const botVersion = await this.prisma.botVersion.findFirst({
      where: { botId, version: versionNumber },
      select: { id: true },
    });
    if (!botVersion) throw new NotFoundException('Versão do bot não encontrada');
    return this.prisma.botRule.create({
      data: { ...dto, botVersionId: botVersion.id },
    });
  }

  async publish(tenantId: string, botId: string, versionNumber: number) {
    await this.findOne(tenantId, botId);
    return this.prisma.$transaction(async (tx) => {
      await tx.botVersion.updateMany({
        where: { botId, published: true },
        data: { published: false },
      });
      await tx.botVersion.updateMany({
        where: { botId, version: versionNumber },
        data: { published: true },
      });
      return tx.bot.update({
        where: { id: botId },
        data: { status: 'active', defaultVersion: versionNumber },
      });
    });
  }
}
