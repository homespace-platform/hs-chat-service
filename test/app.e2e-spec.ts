import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from '../src/modules/health/presentation/health.controller';
import { AuthenticationController } from '../src/modules/authentication/presentation/authentication.controller';
import { GatewayAuthenticationGuard } from '../src/modules/authentication/presentation/guards/gateway-authentication.guard';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController, AuthenticationController],
      providers: [GatewayAuthenticationGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ping (GET) is public', () => {
    return request(app.getHttpServer()).get('/ping').expect(200).expect('pong');
  });

  it('/auth/me (GET) rejects a request without gateway identity', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/me (GET) returns gateway identity', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('X-User-Id', 'user-123')
      .set('X-User-Email', 'user@homespace.vn')
      .set('X-User-Role', 'USER')
      .set('X-User-Authorities', 'CHAT_READ,CHAT_WRITE')
      .expect(200)
      .expect({
        code: 1000,
        result: {
          userId: 'user-123',
          email: 'user@homespace.vn',
          role: 'USER',
          authorities: ['CHAT_READ', 'CHAT_WRITE'],
        },
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
