import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { promisify } from 'util';
import { resolveMx } from 'dns';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokensService } from './tokens.service';
import { EmailVerificationService } from './email-verification.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const resolveMxAsync = promisify(resolveMx);

/**
 * 🔒 P3 — argon2.hash com custos ajustados para 2vCPU/4GB.
 * Defaults (memoryCost 65536) saturam memória sob carga simultânea.
 */
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// 🔒 E6 — Domínios descartáveis conhecidos que geram email temporário.
// Bloqueados no registro para evitar abuso. Lista não exaustiva.
const BLOCKED_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'sharklasers.com',
]);

/**
 * 🔒 E6 — Verifica se o domínio do email tem MX record válido.
 * Rejeita emails de domínios que não recebem email (ex: domínios fake).
 * Timeout de 3s para não bloquear o registro se DNS estiver lento.
 */
async function isValidEmailDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  // Bloqueia domínios descartáveis conhecidos
  if (BLOCKED_EMAIL_DOMAINS.has(domain.toLowerCase())) return false;

  try {
    const mxRecords = await Promise.race([
      resolveMxAsync(domain),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), 3000),
      ),
    ]);
    return mxRecords !== null && mxRecords !== undefined && mxRecords.length > 0;
  } catch {
    // Se o DNS falhar (timeout ou erro), assume válido para não bloquear
    // usuários legítimos por problemas de infra. O SMTP real fará a validação final.
    return true;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokensService: TokensService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    // 🔒 E6 — Valida domínio do email (MX record + blocklist de descartáveis)
    const validDomain = await isValidEmailDomain(dto.email);
    if (!validDomain) {
      throw new BadRequestException('Domínio de e-mail inválido ou não aceita recebimento de mensagens');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTS);
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, passwordHash },
    });

    // Dispara o OTP em background — falha no envio não deve bloquear o cadastro
    // (o usuário pode pedir reenvio na tela de verificação).
    void this.emailVerificationService.sendInitialCode(user.id, user.email);

    return this.issueTokens(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string) {
    const result = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!result) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // 🔒 S4 — NÃO revoga imediatamente: marca como "replaced". O token antigo
    // continua válido por `jwt.refreshGraceMs` (default 30s) para permitir
    // refresh concorrente de múltiplas abas/dispositivos com o mesmo token.
    // Idempotente: se já marcado, refresh na janela de grace apenas atualiza
    // replacedAt (próxima rotação ainda gera novo token válido).
    await this.tokensService.markReplaced(result.tokenRecordId);

    const user = await this.prisma.user.findUnique({ where: { id: result.payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string) {
    const result = await this.tokensService.verifyRefreshToken(refreshToken);
    if (result) {
      await this.tokensService.revokeRefreshToken(result.tokenRecordId);
    }
    return { success: true };
  }

  /**
   * 🔒 S4 — Snapshot do estado do usuário para o frontend decidir qual
   * tela renderizar (verify-email, create-tenant, choose-plan, dashboard
   * bloqueado, dashboard ativo).
   *
   * Inclui `session` com a expiração do access token (em segundos desde
   * epoch) e do refresh token (ISO + segundos). O frontend usa isso para
   * mostrar "sessão expira em X" e disparar o refresh antes do 401.
   *
   * Como o /auth/me é autenticado, temos o userId. O access token vigente
   * não fica disponível aqui (só no header Authorization), mas o frontend
   * pode decodificá-lo — aqui devolvemos só o refresh token expira (vindo
   * do DB), que é a previsão real de "quanto tempo até(logar de novo)".
   */
  async getMeSnapshot(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
      },
    });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    // Busca os tenants do usuário (com a subscription ativa mais recente)
    const tenantUsers = await this.prisma.tenantUser.findMany({
      where: { userId, status: 'active' },
      include: {
        role: { select: { name: true } },
        tenant: {
          include: {
            subscriptions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { plan: true },
            },
          },
        },
      },
    });

    const tenants = tenantUsers.map((tu) => {
      const sub = tu.tenant.subscriptions[0];
      const now = new Date();
      const isActive =
        !!sub &&
        ((sub.status === 'trialing' && (!sub.trialUntil || sub.trialUntil > now)) ||
          (sub.status === 'active' && (!sub.expiresAt || sub.expiresAt > now)));

      return {
        id: tu.tenant.id,
        name: tu.tenant.name,
        slug: tu.tenant.slug,
        role: tu.role.name,
        subscription: sub
          ? {
              status: sub.status,
              plan: sub.plan?.name,
              isActive,
              trialUntil: sub.trialUntil,
              expiresAt: sub.expiresAt,
            }
          : null,
      };
    });

    // 🔒 S4 — Busca o refresh token ativo (não revogado, não substituído ou
    // dentro do grace period, não expirado) mais recente do usuário. Esse
    // `expiresAt` é a previsão real de "quanto tempo até o usuário precisar
    // logar de novo" (considerando que o client faça refresh automático).
    const activeRefresh = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    const session = activeRefresh
      ? {
          refreshExpiresAt: activeRefresh.expiresAt.toISOString(),
          refreshExpiresInSec: Math.max(
            0,
            Math.floor((activeRefresh.expiresAt.getTime() - Date.now()) / 1000),
          ),
        }
      : null;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      },
      tenants,
      session,
    };
  }

  /**
   * 🔒 S4 — Emite os tokens e devolve também `accessTokenExp` (segundos desde
   * epoch) para o frontend inicializar o countdown sem precisar decodificar o JWT.
   */
  private async issueTokens(userId: string, email: string) {
    const [{ token: accessToken, exp: accessTokenExp }, refreshToken] = await Promise.all([
      this.tokensService.generateAccessTokenWithExp(userId, email),
      this.tokensService.generateRefreshToken(userId),
    ]);
    return { accessToken, refreshToken, accessTokenExp };
  }
}
