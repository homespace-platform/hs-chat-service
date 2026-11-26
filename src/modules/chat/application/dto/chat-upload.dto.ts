import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const CHAT_FILE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
};

export class CreateChatUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(512) fileName!: string;
  @IsIn(Object.keys(CHAT_FILE_TYPES)) contentType!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(25 * 1024 * 1024) size!: number;
}
