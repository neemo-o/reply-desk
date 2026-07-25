import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseExpiresInToMs } from '../../common/utils/security';

/** Resultado da verificação de um refresh token (token válido ou dentro do grace period). */
export interface VerifiedRefreshToken {
  payload: any;
  tokenRecordId: string;
  /** True se o token já foi rotacionado mas está dentro do grace period. */
  isWithinGrace: boolean;
}

/**
 * 🔒 S4+S5 — TokensService O(1) via jti + cleanup + expiresAt derivado do config.
 *
 * Mudanças (🔒 S4 — Grace period p/ refresh token rotation):
 * - `payload.jti` é igual ao `RefreshToken.id` (UUID). Refresh rotate = find by id.
 * - `expiresAt` calculado a partir de `JWT_REFRESH_EXPIRES_IN` (não mais hard-code +7d).
 * - Lookup O(1) em vez de O(n) com argon2.verify por loop.
 * - Token rotacionado NÃO é mais revogado imediatamente (`revoked=true`).
 *   Em vez disso marcamos `replacedAt = now()`. O token antigo continua aceito
 *   por `jwt.refreshGraceMs` (default 30s) — permite que múltiplas abas/
 *   dispositivos que compartilham o mesmo refresh token façam refresh
 *   concorrentemente sem queda de sessão. Após o grace, é rejeitado (→ 401).
 *   O cleanup job remove registros expirados/revogados/grace-expired.
 *
 * Mantido: o client recebe refresh tokens opacos (raw), o DB armazena argon2 hash.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async generateAccessToken(userId: string, email: string) {
    return this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn') ?? '15m',
        algorithm: 'HS256',
      },
    );
  }

  /**
   * 🔒 S3 — Token de acesso de curta duração com início absoluto.
   * Retorna também `exp` (em segundos depuis epoch) para o frontend montar
   * um countdown preciso sem precisar decodificar o JWT no client.
   */
  async generateAccessTokenWithExp(
    userId: string,
    email: string,
  ): Promise<{ token: string; exp: number }> {
    const accessExpiresIn = this.configService.get<string>('jwt.accessExpiresIn') ?? '15m';
    const ttlMs = parseExpiresInToMs(accessExpiresIn);
    const token = await this.generateAccessToken(userId, email);
    return { token, exp: Math.floor((Date.now() + ttlMs) / 1000) };
  }

  async generateRefreshToken(userId: string): Promise<string> {
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const ttlMs = parseExpiresInToMs(refreshExpiresIn);
    const expiresAt = new Date(Date.now() + ttlMs);

    // Cria primeiro o registro para obter UUID (será jti do JWT)
    const created = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: 'pending', expiresAt },
    });

    const token = await this.jwtService.signAsync(
      { sub: userId, jti: created.id },
      {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: refreshExpiresIn,
        algorithm: 'HS256',
      },
    );

    const tokenHash = await argon2.hash(token);
    await this.prisma.refreshToken.update({
      where: { id: created.id },
      data: { tokenHash },
    });

    return token;
  }

  /**
   * Verifica um refresh token e devolve o id do registro se válido.
   *
   * Aceita tokens:
   * - Nunca rotacionados (revoked=false, replacedAt=null)
   * - Rotacionados dentro do grace period (replacedAt != null, mas dentro
   *   de `jwt.refreshGraceMs`).  `isWithinGrace=true` nesse caso — chamador
   *   decide se vai rotacionar de novo ou só re-emitir sem revogar.
   * Rejeita:
   * - Revogados explicitamente (revoked=true, ex: logout)
   * - Rotacionados há mais de `jwt.refreshGraceMs` (replacedAt + grace < now)
   * - Expirados (expiresAt < now)
   * - Hash inválido / payload inconsistente
   */
  async verifyRefreshToken(
    token: string,
  ): Promise<VerifiedRefreshToken | null> {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        algorithms: ['HS256'],
      });
    } catch {
      return null;
    }

    if (!payload?.jti || !payload?.sub) return null;

    // O(1): lookup direto do registro pelo id (que é o jti).
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti as string },
    });

    if (!stored) return null;

    // Logout manual — sempre rejeita.
    if (stored.revoked) return null;

    if (stored.expiresAt.getTime() < Date.now()) return null;
    if (stored.userId !== payload.sub) return null;

    // Confirma que o token bruto bate com o hash registrado (proteção contra token
    // falsificado com mesmo jti).
    const ok = await argon2.verify(stored.tokenHash, token);
    if (!ok) return null;

    // 🔒 S4 — Grace period: token já foi rotacionado (replacedAt != null).
    // Aceita apenas se ainda dentro da janela. Fora da janela → rejeita.
    if (stored.replacedAt) {
      const graceMs = this.configService.get<number>('jwt.refreshGraceMs') ?? 30_000;
      const ageMs = Date.now() - stored.replacedAt.getTime();
      if (ageMs > graceMs) return null;
      return { payload, tokenRecordId: stored.id, isWithinGrace: true };
    }

    return { payload, tokenRecordId: stored.id, isWithinGrace: false };
  }

  /**
   * 🔒 S4 — Marca um refresh token como "rotacionado" (substituído por outro),
   * sem revogar imediatamente. O token continua válido por `jwt.refreshGraceMs`
   * para permitir refresh concorrente de múltiplas abas/dispositivos.
   */
  async markReplaced(tokenRecordId: string) {
    await this.prisma.refreshToken.update({
      where: { id: tokenRecordId },
      data: { replacedAt: new Date() },
    });
  }

  async revokeRefreshToken(tokenRecordId: string) {
    await this.prisma.refreshToken.update({
      where: { id: tokenRecordId },
      data: { revoked: true },
    });
  }
}
