import { IsUUID } from 'class-validator';

export class CreateCallTokenDto {
  @IsUUID('4')
  callId!: string;
}
