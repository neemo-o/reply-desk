export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    // 🔒 S4 — Grace period em ms para refresh token rotation.
    // Default 30s: janela onde um refresh token recém-rotacionado ainda é
    // aceito, permitindo múltiplas abas/dispositivos fazerem refresh concorrente.
    refreshGraceMs: parseInt(process.env.JWT_REFRESH_GRACE_MS ?? '30000', 10),
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  evolution: {
    // URL base da Evolution API (sem barra final). Em Docker, geralmente
    // http://evolution-api:8080 (hostname do serviço no compose).
    url: process.env.EVOLUTION_API_URL,
    // API key global configurada no container da Evolution (SERVER_TOKEN/
    // GLOBAL_API_TOKEN). Enviada como header `apikey` em todas as chamadas.
    apiKey: process.env.EVOLUTION_API_KEY,
    // URL pública do backend que a Evolution usará para chamar de volta o
    // webhook. Em Docker: http://api:3000/api/v1/webhooks/evolution.
    // Em produção precisa ser HTTPS e acessível pela Evolution.
    webhookBaseUrl: process.env.EVOLUTION_WEBHOOK_BASE_URL,
    // 🤖 Resposta automática placeholder (temporário).
    // Se EVO_PLACEHOLDER_OWNER_PHONE estiver definido, apenas mensagens vindas
    // desse número recebem a resposta placeholder. Outros números são ignorados
    // (apenas persistidas + logadas) — representa o teste "só responda se for eu".
    // Se EVO_PLACEHOLDER_OWNER_PHONE estiver vazio, responde a TODOS os números
    // (modo "qualquer número recebe placeholder").
    placeholderOwnerPhone: process.env.EVO_PLACEHOLDER_OWNER_PHONE,
    placeholderText:
      process.env.EVO_PLACEHOLDER_TEXT ??
      'Olá! Recebi sua mensagem. Em breve um atendente responderá. 🤖 ReplyDesk',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    checkoutSuccessUrl: process.env.STRIPE_CHECKOUT_SUCCESS_URL,
    checkoutCancelUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL,
  },
  mail: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true = TLS implícito (porta 465)
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? 'ReplyDesk <no-reply@replydesk.com>',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },
});
