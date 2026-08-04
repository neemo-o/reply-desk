import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ValidatedStepContent,
  TextContent,
  ListContent,
  ButtonsContent,
  MediaContent,
  HandoffContent,
  validateStepContent,
} from './broadcast/step-content.validator';
import { isUuid } from '../../common/utils/security';

export interface SandboxEvent {
  direction: 'bot' | 'user';
  type: string;
  text?: string;
  selectedId?: string;
  timestamp: string;
}

export interface TestBotDto {
  /// Texto da primeira mensagem do "usuário" — dispara trigger de keyword.
  startMessage?: string;
  /// Lista de passos a simular pelo usuário (em ordem). Vazio = só o step inicial.
  userMessages?: string[];
}

export interface SandboxResult {
  events: SandboxEvent[];
  finalStatus: 'finished' | 'routed' | 'waiting' | 'error' | 'offline';
  /// steps visitados (para diagnóstico).
  visitedSteps: number[];
}

/**
 * 🧪 SandboxBotService — executa o bot em memória, sem persistir nada.
 * Suporta SIMPLE (1 step) e AGENTS (fluxo multi-step). AUTO não tem sandbox
 * (não é conversacional — dispara pelo scheduler, não via chat).
 */
@Injectable()
export class SandboxBotService {
  private readonly logger = new Logger(SandboxBotService.name);

  constructor(private readonly prisma: PrismaService) {}

  async test(tenantId: string, botId: string, dto: TestBotDto): Promise<SandboxResult> {
    if (!isUuid(botId)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, tenantId, type: { in: ['SIMPLE', 'AGENTS'] } },
      include: {
        triggers: true,
        steps: { orderBy: { ordem: 'asc' } },
      },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');

    const events: SandboxEvent[] = [];
    const visitedSteps: number[] = [];
    const now = () => new Date().toISOString();

    const firstStep = bot.steps[0];
    if (!firstStep) {
      return { events, finalStatus: 'error', visitedSteps };
    }

    // ─── SIMPLE: só emite step 1 e finaliza ───────────────────────
    if (bot.type === 'SIMPLE') {
      const validated = validateStepContent(firstStep.tipoMensagem, firstStep.conteudo as Record<string, unknown>);
      this.emitStep(events, validated, firstStep.tipoMensagem, now());
      visitedSteps.push(firstStep.ordem);
      return { events, finalStatus: 'finished', visitedSteps };
    }

    // ─── AGENTS ───────────────────────────────────────────────────
    const startMessage = dto.startMessage ?? '';
    const userMsgs = dto.userMessages ?? [];

    // 1. Avalia trigger.
    const triggerHit = this.matchTrigger(bot.triggers, startMessage);
    if (!triggerHit) {
      return {
        events: [
          {
            direction: 'bot',
            type: 'no_trigger',
            text: 'Nenhum gatilho casou com a mensagem inicial.',
            timestamp: now(),
          },
        ],
        finalStatus: 'waiting',
        visitedSteps: [],
      };
    }

    // 2. Executa step 1.
    let currentStep = firstStep;
    const visited: number[] = [];
    this.emitStep(
      events,
      validateStepContent(
        currentStep.tipoMensagem,
        currentStep.conteudo as Record<string, unknown>,
      ),
      currentStep.tipoMensagem,
      now(),
    );
    visited.push(currentStep.ordem);

    if (currentStep.tipoMensagem === 'handoff') {
      return { events, finalStatus: 'routed', visitedSteps: visited };
    }

    // 3. Itera sobre userMessages.
    for (const userMsg of userMsgs) {
      events.push({
        direction: 'user',
        type: 'text',
        text: userMsg,
        timestamp: now(),
      });
      const next = this.decideNext(currentStep, userMsg);
      if (next === 'fallback') {
        const fallbackOrder = currentStep.fallbackStepOrder ?? null;
        if (fallbackOrder === null) {
          return { events, finalStatus: 'finished', visitedSteps: visited };
        }
        const fbStep = bot.steps.find((s) => s.ordem === fallbackOrder);
        if (!fbStep) {
          return { events, finalStatus: 'error', visitedSteps: visited };
        }
        currentStep = fbStep;
        this.emitStep(
          events,
          validateStepContent(fbStep.tipoMensagem, fbStep.conteudo as Record<string, unknown>),
          fbStep.tipoMensagem,
          now(),
        );
        visited.push(currentStep.ordem);
        if (currentStep.tipoMensagem === 'handoff') {
          return { events, finalStatus: 'routed', visitedSteps: visited };
        }
        continue;
      }
      if (next === null) {
        return { events, finalStatus: 'finished', visitedSteps: visited };
      }
      const nextStep = bot.steps.find((s) => s.ordem === next);
      if (!nextStep) {
        return { events, finalStatus: 'error', visitedSteps: visited };
      }
      currentStep = nextStep;
      this.emitStep(
        events,
        validateStepContent(nextStep.tipoMensagem, nextStep.conteudo as Record<string, unknown>),
        nextStep.tipoMensagem,
        now(),
      );
      visited.push(currentStep.ordem);
      if (currentStep.tipoMensagem === 'handoff') {
        return { events, finalStatus: 'routed', visitedSteps: visited };
      }
    }

    // 4. Estado final — tratamos HANDOFF já acima; reste está em wait/finish.
    const condicoes =
      (currentStep.condicoesProximo as unknown as { match: string }[] | null) ?? [];
    return {
      events,
      finalStatus:
        visited.length > 0 && condicoes.length > 0 ? 'waiting' : 'finished',
      visitedSteps: visited,
    };
  }

  private matchTrigger(
    triggers: { tipo: string; valor: string | null }[],
    message: string,
  ): boolean {
    if (triggers.length === 0) return false;
    const msg = message.toLowerCase().trim();
    for (const t of triggers) {
      if (t.tipo === 'first_message') return true;
      if (t.tipo === 'keyword' && t.valor && msg.includes(t.valor.toLowerCase())) return true;
    }
    return false;
  }

  private decideNext(
    step: { condicoesProximo: Prisma.JsonValue | null; fallbackStepOrder: number | null },
    userMessage: string,
  ): number | 'fallback' | null {
    const condicoes =
      (step.condicoesProximo as unknown as { match: string; stepOrder: number }[]) ?? [];
    const reply = userMessage.toLowerCase().trim();
    for (const cond of condicoes) {
      if (cond.match.toLowerCase().trim() === reply) {
        return cond.stepOrder;
      }
    }
    return 'fallback';
  }

  private emitStep(
    events: SandboxEvent[],
    conteudo: ValidatedStepContent,
    tipo: string,
    timestamp: string,
  ) {
    if (tipo === 'text') {
      const c = conteudo as TextContent;
      events.push({ direction: 'bot', type: 'text', text: c.text, timestamp });
    } else if (tipo === 'list') {
      const c = conteudo as ListContent;
      events.push({
        direction: 'bot',
        type: 'list',
        text: c.title,
        selectedId: c.sections.flatMap((s) => s.rows.map((r) => `${r.title}:${r.id}`)).join('\n'),
        timestamp,
      });
    } else if (tipo === 'buttons') {
      const c = conteudo as ButtonsContent;
      events.push({
        direction: 'bot',
        type: 'buttons',
        text: c.text,
        selectedId: c.buttons.map((b) => `${b.title}:${b.id}`).join('\n'),
        timestamp,
      });
    } else if (tipo === 'media') {
      const c = conteudo as MediaContent;
      events.push({
        direction: 'bot',
        type: 'media',
        text:
          c.mediaType === 'image' || c.mediaType === 'video' || c.mediaType === 'document'
            ? (c.caption ?? c.url)
            : c.url,
        timestamp,
      });
    } else if (tipo === 'handoff') {
      const c = conteudo as HandoffContent;
      events.push({
        direction: 'bot',
        type: 'handoff',
        text: c.message ?? 'Conversa transferida para atendimento humano.',
        timestamp,
      });
    }
  }
}
