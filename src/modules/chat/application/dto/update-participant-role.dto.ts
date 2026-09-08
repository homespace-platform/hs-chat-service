import { IsIn } from 'class-validator';
import type { ParticipantRole } from '../../domain/participant-role';

export class UpdateParticipantRoleDto {
  @IsIn(['TENANT', 'LANDLORD'])
  role!: ParticipantRole;
}
