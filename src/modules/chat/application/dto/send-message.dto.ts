import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import {
  ParticipantProfileDto,
  RelatedListingDto,
} from './related-listing.dto';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000)
  content!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RelatedListingDto)
  listing?: RelatedListingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipantProfileDto)
  senderProfile?: ParticipantProfileDto;
}
