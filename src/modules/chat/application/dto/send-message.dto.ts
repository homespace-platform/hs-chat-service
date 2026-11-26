import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ParticipantProfileDto,
  RelatedListingDto,
} from './related-listing.dto';
import { MessageAttachmentDto } from './message-attachment.dto';

export class SendMessageDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(5_000)
  content?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RelatedListingDto)
  listing?: RelatedListingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipantProfileDto)
  senderProfile?: ParticipantProfileDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
