import { IsIn, IsString } from 'class-validator';

/**
 * 🔒 S10 — roleName livre para lista fechada (owner / admin / agent).
 * Reaproveita a mesma restrição do InviteUserDto.
 */
export class UpdateMemberRoleDto {
  @IsString()
  @IsIn(['owner', 'admin', 'agent'])
  roleName: 'owner' | 'admin' | 'agent';
}
