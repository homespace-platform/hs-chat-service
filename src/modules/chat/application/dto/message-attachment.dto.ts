import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class MessageAttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  storageId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  sizeBytes!: number;
}
