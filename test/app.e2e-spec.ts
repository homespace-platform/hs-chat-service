import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from '../src/modules/health/presentation/health.controller';
import { AuthenticationController } from '../src/modules/authentication/presentation/authentication.controller';
import { GatewayAuthenticationGuard } from '../src/modules/authentication/presentation/guards/gateway-authentication.guard';
import { ChatController } from '../src/modules/chat/presentation/chat.controller';
import { ChatConversationService } from '../src/modules/chat/application/chat-conversation.service';
import { ChatMessageService } from '../src/modules/chat/application/chat-message.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController, AuthenticationController, ChatController],
      providers: [
        GatewayAuthenticationGuard,
        {
          provide: ChatConversationService,
          useValue: {
            listConversations: async () => [],
            createOrReuseConversation: async () => ({}),
          },
        },
        {
          provide: ChatMessageService,
          useValue: {
            listMessages: async () => ({ items: [] }),
            sendMessage: async () => ({}),
            markRead: async () => ({}),
          },
        },
      ],
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

  it('/conversations (GET) rejects a request without gateway identity', () => {
    return request(app.getHttpServer()).get('/conversations').expect(401);
  });

  it('/conversations (GET) returns the authenticated user conversations', () => {
    return request(app.getHttpServer())
      .get('/conversations')
      .set('X-User-Id', 'user-123')
      .expect(200)
      .expect({ code: 1000, result: [] });
  });

  afterEach(async () => {
    await app.close();
  });
});
