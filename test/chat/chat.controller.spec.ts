import 'reflect-metadata';
import { jest } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GatewayAuthenticationGuard } from '../../src/modules/authentication/presentation/guards/gateway-authentication.guard';
import { ChatController } from '../../src/modules/chat/presentation/chat.controller';

describe('ChatController', () => {
  const conversationService = {
    listConversations: jest.fn(),
    createOrReuseConversation: jest.fn(),
  };
  const messageService = {
    listMessages: jest.fn(),
    sendMessage: jest.fn(),
    markRead: jest.fn(),
  };
  const callService = { createToken: jest.fn() };
  const controller = new ChatController(
    conversationService as never,
    messageService as never,
    callService as never,
  );
  const user = { userId: 'user-a', authorities: [] };

  beforeEach(() => jest.clearAllMocks());

  it('lists conversations for the gateway user', async () => {
    conversationService.listConversations.mockResolvedValueOnce([
      'conversation',
    ]);
    const result = await controller.list(user, { limit: 20 });

    expect(conversationService.listConversations).toHaveBeenCalledWith(
      'user-a',
      20,
    );
    expect(result).toEqual({ code: 1000, result: ['conversation'] });
  });

  it('creates or reuses a conversation for the gateway user', async () => {
    conversationService.createOrReuseConversation.mockResolvedValueOnce(
      'conversation',
    );
    const input = { participantId: 'user-b' };

    await controller.create(user, input);

    expect(conversationService.createOrReuseConversation).toHaveBeenCalledWith(
      'user-a',
      input,
    );
  });

  it('delegates message history, send, and mark-read operations', async () => {
    await controller.messages(user, 'conversation-id', { limit: 10 });
    await controller.send(user, 'conversation-id', { content: 'Xin chào' });
    await controller.read(user, 'conversation-id');

    expect(messageService.listMessages).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      { limit: 10 },
    );
    expect(messageService.sendMessage).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      { content: 'Xin chào' },
    );
    expect(messageService.markRead).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
    );
  });

  it('protects every route with the gateway authentication guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ChatController)).toContain(
      GatewayAuthenticationGuard,
    );
  });

  it('creates a call token for the current participant', async () => {
    callService.createToken.mockResolvedValueOnce({ token: 'token' });

    const result = await controller.callToken(user, 'conversation-id', {
      callId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(callService.createToken).toHaveBeenCalledWith(
      'conversation-id',
      'user-a',
      '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(result).toEqual({ code: 1000, result: { token: 'token' } });
  });
});
