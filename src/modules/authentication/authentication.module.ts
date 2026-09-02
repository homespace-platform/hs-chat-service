import { Module } from '@nestjs/common';
import { AuthenticationController } from './presentation/authentication.controller';
import { GatewayAuthenticationGuard } from './presentation/guards/gateway-authentication.guard';

@Module({
  controllers: [AuthenticationController],
  providers: [GatewayAuthenticationGuard],
})
export class AuthenticationModule {}
