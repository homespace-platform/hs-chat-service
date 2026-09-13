import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 8082;

  @IsString()
  SERVICE_NAME = 'hs-chat-service';

  @IsString()
  @IsNotEmpty()
  MONGODB_URI!: string;

  @IsUrl({ require_tld: false })
  EUREKA_CLIENT_SERVICE_URL = 'http://localhost:8761/eureka';

  @IsString()
  EUREKA_INSTANCE_HOSTNAME = 'localhost';

  @IsOptional()
  @IsString()
  AGORA_APP_ID?: string;

  @IsOptional()
  @IsString()
  AGORA_APP_CERTIFICATE?: string;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  return validated;
}
