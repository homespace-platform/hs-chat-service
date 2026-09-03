import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ChatConversationService } from '../../src/modules/chat/application/chat-conversation.service';
import { DIRECT_CONVERSATION_LISTING_ID } from '../../src/modules/chat/application/conversation-key';

function queryReturning<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('ChatConversationService', () => {
  const conversationModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  let service: ChatConversationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatConversationService(conversationModel as never);
  });

  it('creates a conversation with sorted participants and a direct listing sentinel', async () => {
    conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
    conversationModel.create.mockResolvedValueOnce({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: DIRECT_CONVERSATION_LISTING_ID,
      unreadCounts: { 'user-a': 0, 'user-b': 0 },
    });

    await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(conversationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        participantIds: ['user-a', 'user-b'],
        participantKey: 'user-a:user-b',
        listingId: DIRECT_CONVERSATION_LISTING_ID,
      }),
    );
  });

  it('stores the other participant profile for conversation previews', async () => {
    conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
    conversationModel.create.mockResolvedValueOnce({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: 'listing-1',
      participantProfiles: {
        'user-b': {
          displayName: 'Người cho thuê B',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      },
      unreadCounts: { 'user-a': 0, 'user-b': 0 },
    });

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      participantProfile: {
        displayName: 'Người cho thuê B',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
    });

    expect(conversationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        participantProfiles: {
          'user-b': {
            displayName: 'Người cho thuê B',
            avatarUrl: 'https://example.com/avatar.jpg',
          },
        },
      }),
    );
    expect(result.participantName).toBe('Người cho thuê B');
    expect(result.participantAvatar).toBe('https://example.com/avatar.jpg');
  });

  it('returns an existing conversation instead of creating a duplicate', async () => {
    const existingConversation = {
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: DIRECT_CONVERSATION_LISTING_ID,
      unreadCounts: { 'user-a': 0, 'user-b': 2 },
      lastMessage: 'Xin chào',
    };
    conversationModel.findOne.mockReturnValueOnce(
      queryReturning(existingConversation),
    );

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(conversationModel.create).not.toHaveBeenCalled();
    expect(result.id).toBe('conversation-id');
    expect(result.unreadCount).toBe(0);
  });

  it('fills a missing participant profile when an existing conversation is reopened', async () => {
    conversationModel.findOne.mockReturnValueOnce(
      queryReturning({
        _id: 'conversation-id',
        participantIds: ['user-a', 'user-b'],
        participantProfiles: {},
        unreadCounts: { 'user-a': 0, 'user-b': 0 },
      }),
    );
    conversationModel.updateOne.mockReturnValueOnce(
      queryReturning({ acknowledged: true }),
    );

    await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      participantProfile: { displayName: 'Người cho thuê B' },
    });

    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conversation-id' },
      {
        $set: {
          'participantProfiles.user-b': {
            displayName: 'Người cho thuê B',
          },
        },
      },
    );
  });

  it('rejects self-chat and hides a conversation from non-participants', async () => {
    await expect(
      service.createOrReuseConversation('user-a', { participantId: 'user-a' }),
    ).rejects.toThrow();

    conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
    await expect(
      service.getParticipantOrThrow('conversation-id', 'user-c'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns not found for an invalid Mongo conversation id', async () => {
    await expect(
      service.getParticipantOrThrow('not-an-object-id', 'user-a'),
    ).rejects.toThrow(NotFoundException);
    expect(conversationModel.findOne).not.toHaveBeenCalled();
  });
});
