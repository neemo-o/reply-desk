import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SkipSubscription } from '../../common/decorators/skip-subscription.decorator';

/**
 * 🔒 M6 — @SkipSubscription(): gerir a própria assinatura não requer assinatura
 * ativa. O usuário precisa criar checkout/upgrade/cancel MESMO com assinatura
 * expirada — senão não consegue regularizar pagamento.
 */
@SkipSubscription()
@UseGuards(TenantGuard, RolesGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  getCurrent(@CurrentTenant() tenantId: string) {
    return this.subscriptionsService.getCurrent(tenantId);
  }

  /**
   * Cria uma sessão de checkout no Stripe.
   * billingType "recurring" (padrão): assinatura mensal automática com cartão
   * billingType "one_time": pagamento único (cartão ou Pix, 1 mês de acesso)
   */
  @Roles('owner', 'admin')
  @Post('checkout')
  createCheckout(@CurrentTenant() tenantId: string, @Body() dto: CreateCheckoutDto) {
    return this.subscriptionsService.createCheckout(tenantId, dto.planId, dto.billingType ?? 'recurring');
  }

  /**
   * Upgrade/downgrade de plano.
   * Atualiza a subscription ativa no Stripe com prorratação automática.
   * O Stripe credita dias não usados do plano anterior e debita o proporcional do novo.
   */
  @Roles('owner', 'admin')
  @Patch('upgrade')
  upgradePlan(@CurrentTenant() tenantId: string, @Body() dto: UpgradePlanDto) {
    return this.subscriptionsService.upgradePlan(tenantId, dto.planId);
  }

  /**
   * 🔒 Pré-visualiza o valor da prorratação de um upgrade/downgrade.
   * Não cobra — só simula no Stripe e retorna o valor imediato que seria cobrado.
   */
  @Roles('owner', 'admin')
  @Post('preview-upgrade')
  previewUpgrade(@CurrentTenant() tenantId: string, @Body() dto: UpgradePlanDto) {
    return this.subscriptionsService.previewUpgrade(tenantId, dto.planId);
  }

  /**
   * Cancela a assinatura ativa do tenant.
   * Agenda o cancelamento para o fim do ciclo (padrão SaaS) — o usuário mantém
   * acesso até a data de expiração já paga.
   */
  @Roles('owner', 'admin')
  @Delete('cancel')
  cancel(@CurrentTenant() tenantId: string) {
    return this.subscriptionsService.cancelSubscription(tenantId);
  }

  /**
   * 🔒 Reativa uma assinatura que estava agendada para cancelar.
   * Remove o cancel_at_period_end no Stripe e no DB.
   */
  @Roles('owner', 'admin')
  @Post('reactivate')
  reactivate(@CurrentTenant() tenantId: string) {
    return this.subscriptionsService.reactivateSubscription(tenantId);
  }

  /**
   * 🔒 M18 — Detalhes de faturamento: cartão salvo, próxima fatura e
   * histórico de faturas. Só faz sentido para assinaturas recorrentes.
   */
  @Roles('owner', 'admin')
  @Get('billing-details')
  getBillingDetails(@CurrentTenant() tenantId: string) {
    return this.subscriptionsService.getBillingDetails(tenantId);
  }

  /**
   * 🔒 M18 — Cria sessão de checkout em modo "setup" para o usuário
   * atualizar o cartão de pagamento. Redireciona para URL do Stripe.
   */
  @Roles('owner', 'admin')
  @Post('update-payment-method')
  updatePaymentMethod(@CurrentTenant() tenantId: string) {
    return this.subscriptionsService.createUpdatePaymentMethodSession(tenantId);
  }
}
