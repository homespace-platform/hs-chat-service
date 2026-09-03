import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ParticipantProfileDto, RelatedListingDto } from './related-listing.dto';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  participantId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RelatedListingDto)
  listing?: RelatedListingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipantProfileDto)
  participantProfile?: ParticipantProfileDto;
}
