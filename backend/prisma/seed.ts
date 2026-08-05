import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

/**
 * 🔒 S13 — Seed protegido por NODE_ENV.
 *
 * Nunca rodar em produção. Apenas preenche permissions + planos,
 * e cria os produtos/preços no Stripe automaticamente se as chaves
 * de teste estiverem configuradas.
 */
const PERMISSIONS = [
  'tenant.manage',
  'users.manage',
  'sessions.manage',
  'bots.manage',
  'conversations.manage',
  'conversations.view',
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Seed não pode ser executado em produção. Use migrations Prisma (prisma migrate deploy).',
    );
  }

  const prisma = new PrismaClient();

  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  // Cria os planos no Stripe se a chave estiver configurada
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  let stripe: Stripe | null = null;

  if (stripeSecretKey) {
    stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
    });
    console.log('Stripe configurado — criando produtos/preços...');
  } else {
    console.log('⚠️ STRIPE_SECRET_KEY não configurada — planos sem price IDs do Stripe');
  }

  const PLANS = [
    {
      id: 'basic-plan',
      name: 'Basic',
      price: 49.9,
      maxSessions: 1,
      maxUsers: 3,
      maxBots: 1,
      maxBotsPerType: 1,
      maxActiveBots: 1,
      maxMessages: 2000,
      maxStorageMb: 512,
      maxAiRequests: 0,
    },
    {
      id: 'premium-plan',
      name: 'Premium',
      price: 99.9,
      maxSessions: 3,
      maxUsers: 10,
      maxBots: 5,
      maxBotsPerType: 3,
      maxActiveBots: 3,
      maxMessages: 10000,
      maxStorageMb: 2048,
      maxAiRequests: 5000,
    },
  ];

  for (const plan of PLANS) {
    let stripePriceRecurringId: string | null = null;
    let stripePriceOneTimeId: string | null = null;

    if (stripe) {
      // Cria produto no Stripe
      const product = await stripe.products.create({ name: `ReplyDesk — ${plan.name}` });

      // Preço recorrente (mensal automático)
      const recurringPrice = await stripe.prices.create({
        product: product.id,
        currency: 'brl',
        unit_amount: Math.round(plan.price * 100),
        recurring: { interval: 'month' },
      });
      stripePriceRecurringId = recurringPrice.id;

      // Preço único (pagamento avulso)
      const oneTimePrice = await stripe.prices.create({
        product: product.id,
        currency: 'brl',
        unit_amount: Math.round(plan.price * 100),
      });
      stripePriceOneTimeId = oneTimePrice.id;

      console.log(`  ${plan.name}: recurring=${stripePriceRecurringId}, oneTime=${stripePriceOneTimeId}`);
    }

    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        ...plan,
        ...(stripePriceRecurringId && { stripePriceRecurringId }),
        ...(stripePriceOneTimeId && { stripePriceOneTimeId }),
      },
      create: {
        ...plan,
        ...(stripePriceRecurringId && { stripePriceRecurringId }),
        ...(stripePriceOneTimeId && { stripePriceOneTimeId }),
      },
    });
  }

  console.log('Seed concluído (apenas dev/staging)');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
