import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { ChatCallService } from '../../src/modules/chat/application/chat-call.service';

describe('ChatCallService', () => {
  const conversationService = { getParticipantOrThrow: jest.fn() };
  const callId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => jest.clearAllMocks());

  it('checks membership and creates an account-bound Agora token', async () => {
    conversationService.getParticipantOrThrow.mockResolvedValueOnce({});
    const service = new ChatCallService(
      new ConfigService({
        AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
        AGORA_APP_CERTIFICATE: 'abcdef0123456789abcdef0123456789',
      }),
      conversationService as never,
    );

    const result = await service.createToken(
      'conversation-id',
      'user-a',
      callId,
    );

    expect(conversationService.getParticipantOrThrow).toHaveBeenCalledWith(
      'conversation-id',
      'user-a',
    );
    expect(result).toEqual(
      expect.objectContaining({
        appId: '0123456789abcdef0123456789abcdef',
        channel: 'hs_123e4567e89b42d3a456426614174000',
        uid: 'user-a',
        expiresIn: 3600,
        token: expect.any(String),
      }),
    );
  });

  it('fails clearly when Agora credentials are missing', async () => {
    conversationService.getParticipantOrThrow.mockResolvedValueOnce({});
    const service = new ChatCallService(
      new ConfigService({}),
      conversationService as never,
    );

    await expect(
      service.createToken('conversation-id', 'user-a', callId),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
