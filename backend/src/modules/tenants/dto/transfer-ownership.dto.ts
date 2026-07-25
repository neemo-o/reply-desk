import { IsUUID } from 'class-validator';

/**
 * 🔒 M17 — Payload da transferência de ownership.
 *
 * `newOwnerTenantUserId` é o id do TenantUser que será promovido a owner.
 * Precisa ser um membro ativo do mesmo tenant. O dono atual é rebaixado
 * a admin automaticamente (transação atômica).
 */
export class TransferOwnershipDto {
  @IsUUID()
  newOwnerTenantUserId!: string;
}
