import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PlanLimitsService } from './plan-limits.service';
import type Stripe from 'stripe';

interface SubscriptionLike {
  status: string;
  trialUntil: Date | null;
  expiresAt: Date | null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002';
}

export type BillingType = 'recurring' | 'one_time';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Uma assinatura é considerada ativa se:
   * - status "trialing" e o período de trial ainda não expirou; ou
   * - status "active" e não passou da data de expiração.
   * Qualquer outro status (pending, past_due, cancelled) bloqueia o acesso.
   */
  isActive(subscription: SubscriptionLike): boolean {
    const now = new Date();
    if (subscription.status === 'trialing') {
      return !subscription.trialUntil || subscription.trialUntil > now;
    }
    if (subscription.status === 'active') {
      return !subscription.expiresAt || subscription.expiresAt > now;
    }
    return false;
  }

  async getCurrent(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) return null;
    return { ...subscription, isActive: this.isActive(subscription) };
  }

  /**
   * Cria uma sessão de checkout no Stripe.
   * - billingType "recurring": assinatura mensal automática (cartão de crédito)
   * - billingType "one_time": pagamento único (cartão ou Pix, 1 mês de acesso)
   */
  async createCheckout(tenantId: string, planId: string, billingType: BillingType = 'recurring') {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    // Valida que o plano tem o price ID do Stripe para o tipo de cobrança
    const priceId =
      billingType === 'recurring' ? plan.stripePriceRecurringId : plan.stripePriceOneTimeId;
    if (!priceId) {
      throw new BadRequestException(
        `Plano não configurado no Stripe para pagamento ${billingType === 'recurring' ? 'recorrente' : 'único'}`,
      );
    }

    const owner = await this.prisma.tenantUser.findFirst({
      where: { tenantId, role: { name: 'owner' } },
      include: { user: { select: { email: true, emailVerified: true } } },
    });
    if (!owner) throw new NotFoundException('Owner do tenant não encontrado');
    if (!owner.user.emailVerified) {
      throw new ForbiddenException('Confirme seu e-mail antes de contratar um plano');
    }

    const baseSuccessUrl = this.config.get<string>('stripe.checkoutSuccessUrl');
    const baseCancelUrl = this.config.get<string>('stripe.checkoutCancelUrl');
    if (!baseSuccessUrl || !baseCancelUrl) {
      throw new BadRequestException('STRIPE_CHECKOUT_SUCCESS_URL/CANCEL_URL não configuradas');
    }

    // 🔒 Frontend precisa distinguir retorno de sucesso vs. cancelamento na mesma
    // rota de callback — anexamos query params (session_id via template do Stripe).
    const successUrl = `${baseSuccessUrl}${baseSuccessUrl.includes('?') ? '&' : '?'}checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseCancelUrl}${baseCancelUrl.includes('?') ? '&' : '?'}checkout=cancelled`;

    // 🔒 Advisory lock por tenant — serializa o checkout, elimina race condition
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; external_id: string | null; plan_id: string; billing_type: string; trial_until: Date | null; expires_at: Date | null }>
      >`SELECT id, status, external_id, plan_id, billing_type, trial_until, expires_at FROM subscriptions WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`;

      const current = rows[0]
        ? {
            id: rows[0].id,
            status: rows[0].status,
            externalId: rows[0].external_id,
            planId: rows[0].plan_id,
            billingType: rows[0].billing_type,
            trialUntil: rows[0].trial_until,
            expiresAt: rows[0].expires_at,
          }
        : null;

      // Bloqueia se já tem assinatura ativa ou em trial válida
      if (current && this.isActive({ status: current.status, trialUntil: current.trialUntil, expiresAt: current.expiresAt }) && (current.status === 'active' || current.status === 'trialing')) {
        throw new ConflictException('Este tenant já possui uma assinatura ativa');
      }

      // Reusa subscription pending existente
      const subscriptionId = current && current.status === 'pending' ? current.id : randomUUID();

      // 🔒 Trial de 7 dias apenas para o plano Basic E apenas para novos usuários.
      // Considera "novo usuário" = nunca teve subscription ativa, trial, cancelada
      // ou past_due. Subscription pending (checkout não completado) não conta.
      const hadPreviousSubscription =
        current !== null &&
        current.status !== 'pending';
      const hasTrial = plan.id === 'basic-plan' && !hadPreviousSubscription;

      const checkoutInput = {
        priceId,
        customerEmail: owner.user.email,
        tenantId,
        subscriptionId,
        successUrl,
        cancelUrl,
        hasTrial,
      };

      let result: { checkoutUrl: string; sessionId: string };
      if (billingType === 'recurring') {
        result = await this.stripe.createRecurringCheckoutSession(checkoutInput);
      } else {
        result = await this.stripe.createOneTimeCheckoutSession(checkoutInput);
      }

      await tx.subscription.upsert({
              where: { id: subscriptionId },
              update: {
                planId: plan.id,
                status: 'pending',
                externalId: result.sessionId,
                billingType,
              },
              create: {
                id: subscriptionId,
                tenantId,
                planId: plan.id,
                status: 'pending',
                externalId: result.sessionId,
                billingType,
              },
            });

            return { checkoutUrl: result.checkoutUrl, subscriptionId, billingType };
          });
        }

  /**
   * 🔒 Cancela a assinatura ativa do tenant — agenda para o fim do ciclo.
   *
   * Padrão SaaS: usuário pagou o mês, mantém acesso até expiresAt.
   * O Stripe envia customer.subscription.deleted quando o ciclo acaba —
   * o webhook marca status 'cancelled' no DB.
   *
   * Para pagamento único (one_time): cancela imediatamente no DB.
   */
  async cancelSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['active', 'past_due', 'pending', 'trialing'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada');
    }

    // Pagamento único não tem ciclo recorrente no Stripe — cancela imediatamente.
    if (subscription.billingType !== 'recurring') {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'cancelled', cancelAtPeriodEnd: false },
      });
      return { cancelled: true, scheduled: false, subscriptionId: subscription.id };
    }

    // Recorrente: se ainda não tem sub_ ID (webhook não processou), cancela via session.
    let stripeSubId: string | null = null;
    if (subscription.externalId?.startsWith('sub_')) {
      stripeSubId = subscription.externalId;
    } else if (subscription.externalId) {
      try {
        const session = await this.stripe.client.checkout.sessions.retrieve(subscription.externalId);
        stripeSubId = (session.subscription as string) ?? null;
      } catch (err) {
        this.logger.warn(`Erro ao buscar session para cancelar: ${(err as Error).message}`);
      }
    }

    if (!stripeSubId) {
      throw new BadRequestException('Assinatura ainda não foi ativada no Stripe — aguarde o processamento do pagamento');
    }

    // Agenda cancelamento no fim do ciclo — usuário mantém acesso até expiresAt.
    try {
      await this.stripe.scheduleCancelAtPeriodEnd(stripeSubId);
    } catch (err) {
      this.logger.warn(`Erro ao agendar cancelamento no Stripe: ${(err as Error).message}`);
      throw new BadRequestException('Não foi possível agendar o cancelamento no Stripe');
    }

    // Marca a intenção no DB — status continua 'active' até o webhook deleted chegar.
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });

    return { cancelled: true, scheduled: true, subscriptionId: subscription.id };
  }

  /**
   * 🔒 Reativa uma assinatura que estava agendada para cancelar no fim do ciclo.
   * Remove o cancel_at_period_end no Stripe e no DB.
   */
  async reactivateSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, cancelAtPeriodEnd: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura com cancelamento agendado encontrada');
    }

    if (subscription.billingType !== 'recurring' || !subscription.externalId?.startsWith('sub_')) {
      throw new BadRequestException('Reativação só está disponível para assinaturas recorrentes ativas');
    }

    await this.stripe.reactivateSubscription(subscription.externalId);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false },
    });

    return { reactivated: true, subscriptionId: subscription.id };
  }

  /**
   * 🔒 Upgrade/downgrade de plano.
   * Só funciona para subscriptions recorrentes ativas ou em trial.
   * O Stripe faz a prorratação automaticamente (credita dias não usados,
   * debita proporcional do novo plano).
   */
  async upgradePlan(tenantId: string, newPlanId: string) {
    // Valida o novo plano
    const newPlan = await this.prisma.plan.findUnique({ where: { id: newPlanId } });
    if (!newPlan) throw new NotFoundException('Plano não encontrado');
    if (!newPlan.stripePriceRecurringId) {
      throw new BadRequestException('Novo plano não configurado no Stripe para pagamento recorrente');
    }

    // Busca a subscription ativa/trialing do tenant
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['active', 'trialing'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada para upgrade');
    }

    if (subscription.billingType !== 'recurring') {
      throw new BadRequestException('Upgrade só está disponível para assinaturas recorrentes');
    }

    if (!subscription.externalId || !subscription.externalId.startsWith('sub_')) {
      throw new BadRequestException('Assinatura ainda não foi ativada no Stripe — aguarde o processamento do pagamento');
    }

    if (subscription.planId === newPlanId) {
      throw new BadRequestException('Você já está neste plano');
    }

    // 🔒 Se o tenant tem cancelamento agendado, bloqueia troca de plano.
    // O usuário precisa reativar a assinatura antes de fazer upgrade/downgrade.
    if (subscription.cancelAtPeriodEnd) {
      throw new ConflictException(
        'Você tem um cancelamento agendado. Reative a assinatura antes de trocar de plano.',
      );
    }

    // 🔒 M8 — Se for downgrade (novo plano mais barato), verifica se os recursos
    // ativos excedem os limites do novo plano. Bloqueia se exceder.
    const currentPlan = await this.prisma.plan.findUnique({
      where: { id: subscription.planId },
    });
    if (currentPlan && newPlan.price < currentPlan.price) {
      await this.planLimits.assertCanDowngrade(tenantId, newPlanId);
    }

    // Atualiza no Stripe com prorratação
    // payment_behavior: 'pending_if_incomplete' faz o Stripe reter a troca
    // se o pagamento da prorratação falhar (cartão recusado).
    const updatedSub = await this.stripe.updateSubscriptionPlan(
      subscription.externalId,
      newPlan.stripePriceRecurringId,
    );

    // 🔒 Se a prorratação falhou (cartão recusado), o Stripe retorna status
    // 'incomplete' ou 'past_due'. Não atualizamos o DB — o usuário continua
    // no plano anterior.
    if (updatedSub.status === 'incomplete' || updatedSub.status === 'past_due') {
      const latestInvoice = updatedSub.latest_invoice;
      let errorMessage = 'O pagamento da prorratação foi recusado. Verifique seu cartão e tente novamente.';
      if (typeof latestInvoice === 'object' && latestInvoice !== null) {
        const paymentIntent = (latestInvoice as Stripe.Invoice).payment_intent;
        if (typeof paymentIntent === 'object' && paymentIntent !== null) {
          const declineMessage = (paymentIntent as Stripe.PaymentIntent).last_payment_error?.message;
          if (declineMessage) errorMessage = `Pagamento recusado: ${declineMessage}`;
        }
      }

      throw new BadRequestException({
        message: errorMessage,
        code: 'PRORATION_PAYMENT_FAILED',
        stripeStatus: updatedSub.status,
      });
    }

    // Pagamento aceito — atualiza no DB
    const currentPeriodEnd = updatedSub.current_period_end
      ? new Date(updatedSub.current_period_end * 1000)
      : null;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: newPlan.id,
        expiresAt: currentPeriodEnd,
      },
    });

    return {
      upgraded: true,
      subscriptionId: subscription.id,
      newPlan: newPlan.name,
      newPrice: newPlan.price,
    };
  }

  /**
   * 🔒 Pré-visualiza o valor da prorratação de um upgrade/downgrade.
   * Não cobra — só simula no Stripe e retorna o valor que seria cobrado.
   */
  async previewUpgrade(tenantId: string, newPlanId: string) {
    const newPlan = await this.prisma.plan.findUnique({ where: { id: newPlanId } });
    if (!newPlan) throw new NotFoundException('Plano não encontrado');
    if (!newPlan.stripePriceRecurringId) {
      throw new BadRequestException('Plano não configurado para pagamento recorrente');
    }

    // Busca a subscription ativa do tenant
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['active', 'trialing'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada');
    }
    if (subscription.billingType !== 'recurring') {
      throw new BadRequestException('Pré-visualização só está disponível para assinaturas recorrentes');
    }
    if (!subscription.externalId?.startsWith('sub_')) {
      throw new BadRequestException('Assinatura ainda não foi ativada no Stripe');
    }
    if (subscription.planId === newPlanId) {
      throw new BadRequestException('Você já está neste plano');
    }
    if (subscription.cancelAtPeriodEnd) {
      throw new ConflictException(
        'Você tem um cancelamento agendado. Reative a assinatura antes de trocar de plano.',
      );
    }

    const currentPlan = await this.prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    // Pede ao Stripe para simular a prorratação
    const preview = await this.stripe.previewUpgradeInvoice(
      subscription.externalId,
      newPlan.stripePriceRecurringId,
    );

    // amountDue vem em centavos — converte para valor decimal
    const amountDue = preview.amountDue / 100;

    return {
      currentPlan: currentPlan?.name ?? null,
      newPlan: newPlan.name,
      amountDue,
      currency: preview.currency,
      isUpgrade: currentPlan ? newPlan.price > currentPlan.price : true,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 🔒 M18 — Gestão de método de pagamento e faturas
  // ════════════════════════════════════════════════════════════════════

  /**
   * Retorna os detalhes de faturamento para a aba de billing:
   * - Cartão salvo (brand + last4 + validade)
   * - Próxima fatura (valor + data)
   * - Histórico de faturas pagas/pendentes
   */
  async getBillingDetails(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura encontrada para este tenant');
    }

    // 🔒 Sem externalId ainda (checkout não completado) — não há o que consultar
    // no Stripe. Retorna estrutura vazia para o frontend renderizar o estado
    // de "aguardando pagamento" sem erro.
    if (!subscription.externalId) {
      return {
        paymentMethod: null,
        upcomingInvoice: null,
        invoices: [],
        subscription: {
          status: subscription.status,
          planName: subscription.plan.name,
          billingType: subscription.billingType,
        },
      };
    }

    // 🔒 Pagamento único (one_time): o Stripe NÃO cria Customer em modo payment,
    // só um PaymentIntent. Os dados do cartão estão no charge, não em
    // payment_methods do customer. Buscamos diretamente pelo PaymentIntent
    // (last_payment_id) — retorna cartão usado + item de histórico sintético.
    //
    // Para recorrente (recurring): resolve customer via subscription, lista
    // payment_methods + upcoming invoice + invoices pagas.
    const isRecurring = subscription.billingType === 'recurring';

    if (!isRecurring) {
      // Para one_time, o last_payment_id contém o PaymentIntent (pi_...).
      const paymentIntentId = subscription.lastPaymentId;
      if (!paymentIntentId) {
        return {
          paymentMethod: null,
          upcomingInvoice: null,
          invoices: [],
          subscription: {
            status: subscription.status,
            planName: subscription.plan.name,
            billingType: subscription.billingType,
          },
        };
      }

      const oneTime = await this.stripe.getOneTimePaymentDetails(paymentIntentId);

      return {
        paymentMethod: oneTime.paymentMethod,
        upcomingInvoice: null,
        invoices: oneTime.invoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          amountDue: inv.amountDue / 100,
          amountPaid: inv.amountPaid / 100,
          currency: inv.currency,
          createdAt: inv.createdAt,
          paidAt: inv.paidAt,
          invoiceUrl: inv.invoiceUrl,
          invoicePdf: inv.invoicePdf,
          receiptUrl: inv.receiptUrl,
        })),
        subscription: {
          status: subscription.status,
          planName: subscription.plan.name,
          billingType: subscription.billingType,
        },
      };
    }

    // 🔒 Recorrente: resolve customer ID via subscription no Stripe.
    const customerId = await this.stripe.getCustomerId(subscription.externalId);
    if (!customerId) {
      throw new BadGatewayException('Não foi possível obter o customer ID do Stripe');
    }

    const [paymentMethods, upcomingInvoice, invoices] = await Promise.all([
      this.stripe.listPaymentMethods(customerId),
      this.stripe.getUpcomingInvoice(customerId),
      this.stripe.listInvoices(customerId, 12),
    ]);

    // Filtra só o cartão padrão para mostrar
    const defaultCard = paymentMethods.find((pm) => pm.isDefault) ?? paymentMethods[0] ?? null;

    return {
      paymentMethod: defaultCard
        ? {
            brand: defaultCard.brand,
            last4: defaultCard.last4,
            expMonth: defaultCard.expMonth,
            expYear: defaultCard.expYear,
          }
        : null,
      upcomingInvoice: upcomingInvoice
        ? {
            amountDue: upcomingInvoice.amountDue / 100,
            currency: upcomingInvoice.currency,
            periodEnd: upcomingInvoice.periodEnd,
            lines: upcomingInvoice.lines.map((l) => ({
              description: l.description,
              amount: l.amount / 100,
              quantity: l.quantity,
            })),
          }
        : null,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountDue: inv.amountDue / 100,
        amountPaid: inv.amountPaid / 100,
        currency: inv.currency,
        createdAt: inv.createdAt,
        paidAt: inv.paidAt,
        invoiceUrl: inv.invoiceUrl,
        invoicePdf: inv.invoicePdf,
        receiptUrl: inv.receiptUrl,
      })),
      subscription: {
        status: subscription.status,
        planName: subscription.plan.name,
        billingType: subscription.billingType,
      },
    };
  }

  /**
   * Cria uma Checkout Session em modo "setup" para o usuário atualizar o
   * cartão de pagamento. Retorna a URL de checkout para redirecionar.
   */
  async createUpdatePaymentMethodSession(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['active', 'trialing', 'past_due'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada');
    }
    // 🔒 Atualização de cartão só faz sentido para assinaturas recorrentes
    // (a cobrança é automática). Pagamento único usa o cartão apenas uma vez
    // no checkout — não há subscription no Stripe para definir default_payment_method.
    if (subscription.billingType !== 'recurring') {
      throw new BadRequestException('Atualização de cartão só está disponível para assinaturas recorrentes');
    }
    if (!subscription.externalId?.startsWith('sub_')) {
      throw new BadRequestException('Assinatura ainda não foi ativada no Stripe — aguarde o processamento do pagamento');
    }

    const customerId = await this.stripe.getCustomerId(subscription.externalId);
    if (!customerId) {
      throw new BadGatewayException('Não foi possível obter o customer ID do Stripe');
    }

    const baseSuccessUrl = this.config.get<string>('stripe.checkoutSuccessUrl');
    const baseCancelUrl = this.config.get<string>('stripe.checkoutCancelUrl');
    if (!baseSuccessUrl || !baseCancelUrl) {
      throw new BadRequestException('STRIPE_CHECKOUT_SUCCESS_URL/CANCEL_URL não configuradas');
    }

    const successUrl = `${baseSuccessUrl}${baseSuccessUrl.includes('?') ? '&' : '?'}setup=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseCancelUrl}${baseCancelUrl.includes('?') ? '&' : '?'}setup=cancelled`;

    return this.stripe.createSetupCheckoutSession({
      customerId,
      tenantId,
      successUrl,
      cancelUrl,
    });
  }

  /**
   * 🔒 Processa webhooks do Stripe com validação de assinatura e idempotência.
   */
  async handleWebhookEvent(event: Stripe.Event) {
    // 🔒 Rejeita eventos de teste em produção — evita que webhooks de sandbox
    // ativem assinaturas reais sem pagamento
    if (process.env.NODE_ENV === 'production' && event.livemode === false) {
      this.logger.warn(`Evento de teste Stripe rejeitado em produção: ${event.id} (${event.type})`);
      throw new ForbiddenException('Eventos de teste não são permitidos em produção');
    }

    const eventId = event.id;
    const eventType = event.type;

    // Idempotência — mesmo evento nunca é processado duas vezes
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: 'stripe', externalId: eventId, eventType },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        this.logger.log(`Evento Stripe ${eventId} já processado — ignorado`);
        return { received: true, duplicate: true };
      }
      throw err;
    }

    switch (eventType) {
      case 'checkout.session.completed': {
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'invoice.payment_failed': {
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;
      }
      default: {
        this.logger.log(`Evento Stripe ${eventType} ignorado`);
        return { received: true, ignored: true };
      }
    }

    return { received: true };
  }

  /**
   * Quando o checkout é completado — atualiza a subscription local.
   * Para recurring: o Stripe já criou a subscription, pegamos o ID.
   * Para one_time: o pagamento foi confirmado, damos 1 mês de acesso.
   */
  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const tenantId = session.client_reference_id;
    if (!tenantId) {
      this.logger.warn('Checkout sem client_reference_id');
      return;
    }

    // Busca a subscription local pelo session ID (cs_test_...).
    // Se o webhook customer.subscription.updated chegou ANTES (race condition),
    // o externalId no DB já foi mudado para sub_... — nesse caso faz fallback
    // buscando por tenantId + status ativo.
    let subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, externalId: session.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      // Fallback: subscription.updated já mudou o externalId para sub_...
      // Usa o subscription ID do Stripe vindo na session para buscar diretamente.
      const stripeSubId = session.subscription as string | null;
      if (stripeSubId) {
        subscription = await this.prisma.subscription.findFirst({
          where: { tenantId, externalId: stripeSubId },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    if (!subscription) {
      // Último fallback: busca qualquer subscription ativa do tenant
      subscription = await this.prisma.subscription.findFirst({
        where: { tenantId, status: { in: ['pending', 'active', 'trialing'] } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!subscription) {
      this.logger.warn(`Nenhuma subscription local para session ${session.id}`);
      return;
    }

    if (session.mode === 'subscription' && session.subscription) {
      // Recorrente: atualiza externalId para o subscription ID do Stripe.
      // Em modo subscription, o Stripe NÃO usa payment_intent — usa latest_invoice.
      // Buscamos a subscription do Stripe para pegar current_period_end e latest_invoice
      // em vez de calcular manualmente oneMonthFromNow() que pode dessincronizar do Stripe.
      const stripeSubId = session.subscription as string;
      const stripeSub = await this.stripe.getSubscription(stripeSubId);
      const currentPeriodEnd = stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : this.oneMonthFromNow();
      const invoiceId = stripeSub.latest_invoice as string | null;

      // 🔒 Trial: se o Stripe criou a subscription em trialing (trial_period_days=7),
      // o status no Stripe é 'trialing' — mapeamos para 'trialing' no DB
      // em vez de 'active' para o isActive verificar trialUntil.
      const isTrialing = stripeSub.status === 'trialing';
      const trialEnd = stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000)
        : null;

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: isTrialing ? 'trialing' : 'active',
          externalId: stripeSubId,
          lastPaymentId: invoiceId,
          startsAt: new Date(),
          expiresAt: currentPeriodEnd,
          trialUntil: trialEnd,
        },
      });
    } else if (session.mode === 'payment') {
      // Pagamento único: ativa por 1 mês.
      // Em modo payment, payment_intent está disponível normalmente.
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'active',
          lastPaymentId: session.payment_intent as string,
          startsAt: new Date(),
          expiresAt: this.oneMonthFromNow(),
        },
      });
    } else if (session.mode === 'setup') {
      // 🔒 M18 — Setup mode: usuário atualizou o cartão via Checkout Session.
      // O Stripe já anexou o payment method ao customer. Precisamos definir
      // como default e atualizar a subscription ativa para usar o novo cartão.
      const setupIntentId = session.setup_intent as string | null;
      if (setupIntentId) {
        const setupIntent = await this.stripe.client.setupIntents.retrieve(setupIntentId);
        const paymentMethodId = setupIntent.payment_method as string | null;
        const customerId = setupIntent.customer as string | null;
        if (paymentMethodId && customerId) {
          // Busca a subscription ativa do tenant para atualizar o default_payment_method
          const activeSub = await this.prisma.subscription.findFirst({
            where: { tenantId, status: { in: ['active', 'trialing', 'past_due'] } },
            orderBy: { createdAt: 'desc' },
          });
          const stripeSubId = activeSub?.externalId?.startsWith('sub_')
            ? activeSub.externalId
            : undefined;
          await this.stripe.attachPaymentMethodAndSetDefault(
            customerId,
            paymentMethodId,
            stripeSubId,
          );
          this.logger.log(
            `Payment method atualizado para tenant ${tenantId} via setup checkout`,
          );
        }
      }
    }
  }

  /**
   * Quando o Stripe atualiza/cancela uma assinatura recorrente.
   * Sincroniza o status do Stripe com o banco local.
   *
   * 🔒 P3: Se o webhook customer.subscription.updated chegar ANTES do
   * checkout.session.completed (Stripe não garante ordem), o externalId no DB
   * ainda é cs_... e não sub_... — findUnique por externalId retorna null.
   * Faz fallback usando o tenantId do metadata da subscription do Stripe.
   */
  private async handleSubscriptionUpdate(stripeSubscription: Stripe.Subscription) {
    // Busca direta pelo externalId (fluxo normal — checkout já processado)
    let subscription = await this.prisma.subscription.findUnique({
      where: { externalId: stripeSubscription.id },
    });

    // Fallback: se o checkout.session.completed ainda não rodou, externalId
    // no DB ainda é o session ID. Usa o tenantId do metadata para encontrar.
    if (!subscription) {
      const tenantId = stripeSubscription.metadata?.tenantId;
      if (tenantId) {
        subscription = await this.prisma.subscription.findFirst({
          where: { tenantId, status: { in: ['pending', 'active', 'trialing'] } },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    if (!subscription) {
      this.logger.warn(`Nenhuma subscription local para Stripe sub ${stripeSubscription.id}`);
      return;
    }

    const status = this.mapStripeStatus(stripeSubscription.status);
    const currentPeriodEnd = stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000)
      : null;

    // 🔒 P6: Se o Stripe envia status trialing, preserva trialUntil a partir
    // do trial_end do Stripe em vez de fundir trialing → active sem trialUntil.
    const trialEnd = stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : null;

    // Constrói o update dinamicamente — só sobrescreve expiresAt e trialUntil
    // se o Stripe enviou valores reais, evitando dessincronizar o que o
    // checkout.session.completed já setou corretamente.
    const updateData: Record<string, unknown> = {
      status,
      // Se encontrou via fallback, sincroniza o externalId para o sub_ ID correto
      ...(subscription.externalId !== stripeSubscription.id && {
        externalId: stripeSubscription.id,
      }),
    };

    if (currentPeriodEnd) {
      updateData.expiresAt = currentPeriodEnd;
    }

    if (trialEnd) {
      updateData.trialUntil = trialEnd;
    } else if (stripeSubscription.status === 'canceled') {
      // Limpa trialOnly quando a subscription é cancelada
      updateData.trialUntil = null;
    }

    // 🔒 Sincroniza cancelAtPeriodEnd com o Stripe.
    // - Quando cancel_at_period_end = true: usuário pediu cancelamento, mantém acesso até o fim.
    // - Quando o webhook "deleted" chega (fim do ciclo): status 'canceled' + cancelAtPeriodEnd false.
    // - Quando o usuário reativa via nossa API: cancel_at_period_end = false novamente.
    if (stripeSubscription.status === 'canceled') {
      // Fim do ciclo reached — marca como cancelled definitivo.
      updateData.cancelAtPeriodEnd = false;
    } else {
      updateData.cancelAtPeriodEnd = Boolean(stripeSubscription.cancel_at_period_end);
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: updateData as any,
    });
  }

  /**
   * 🔒 M9 — Quando oStripe não consegue cobrar a fatura recorrente.
   *
   * O Stripe envia invoice.payment_failed quando a cobrança automática mensal
   * falha (cartão expirado, saldo insuficiente, etc). A subscription entra
   * em "past_due" no Stripe, mas nosso webhook customer.subscription.updated
   * pode demorar para chegar. Marcamos como past_due imediatamente aqui
   * para bloquear o tenant o quanto antes (SubscriptionGuard verifica isActive).
   *
   * Nota: o Stripe tenta cobrar até 4 vezes em 4 dias antes de cancelar
   * definitivamente a subscription. Durante esse período, o tenant fica
   * bloqueado mas não cancelado — o usuário pode atualizar o cartão e retomar.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    // Busca a subscription local pelo subscription ID do Stripe
    const stripeSubId = invoice.subscription as string | null;
    if (!stripeSubId) {
      this.logger.warn('invoice.payment_failed sem subscription ID');
      return;
    }

    let subscription = await this.prisma.subscription.findUnique({
      where: { externalId: stripeSubId },
    });

    // Fallback: busca por tenantId no metadata da invoice
    if (!subscription) {
      const tenantId = (invoice.metadata?.tenantId as string | undefined) ??
        (invoice.subscription_details?.metadata?.tenantId as string | undefined);
      if (tenantId) {
        subscription = await this.prisma.subscription.findFirst({
          where: { tenantId, status: { in: ['active', 'trialing', 'past_due'] } },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    if (!subscription) {
      this.logger.warn(`Nenhuma subscription local para Stripe invoice ${invoice.id}`);
      return;
    }

    // Marca como past_due imediatamente — SubscriptionGuard bloqueia o acesso
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'past_due',
        // Sincroniza externalId se encontrou via fallback
        ...(subscription.externalId !== stripeSubId && { externalId: stripeSubId }),
        lastPaymentId: invoice.id,
      },
    });

    this.logger.warn(
      `Pagamento falhou para tenant ${subscription.tenantId} — ` +
      `subscription ${subscription.id} marcada como past_due ` +
      `(invoice ${invoice.id}, tentativa ${invoice.attempt_count})`,
    );
  }

  private mapStripeStatus(stripeStatus: string): string {
    switch (stripeStatus) {
      case 'active':
        return 'active';
      case 'trialing':
        return 'trialing';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      case 'canceled':
        return 'cancelled';
      case 'incomplete':
      case 'incomplete_expired':
        return 'pending';
      default:
        return 'pending';
    }
  }

  private oneMonthFromNow(): Date {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date;
  }
}
