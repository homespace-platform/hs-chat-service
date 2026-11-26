import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ChatConversationService } from '../../src/modules/chat/application/chat-conversation.service';
import { DIRECT_CONVERSATION_LISTING_ID } from '../../src/modules/chat/application/conversation-key';

function queryReturning<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

// findOne(...).sort(...).exec(): the lookup of the pair's (most recent) conversation.
function sortedQueryReturning<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(queryReturning(value)) };
}

const listing = (id: string) => ({
  id,
  title: 'Nhà',
  price: '1',
  location: 'HCM',
  image: 'x',
});

describe('ChatConversationService', () => {
  const conversationModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    distinct: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  let service: ChatConversationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ChatConversationService(conversationModel as never);
  });

  it('creates a conversation with sorted participants and a direct listing sentinel', async () => {
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));
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
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));
    conversationModel.create.mockResolvedValueOnce({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: DIRECT_CONVERSATION_LISTING_ID,
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
    conversationModel.findOne.mockReturnValueOnce(
      sortedQueryReturning({
        _id: 'conversation-id',
        participantIds: ['user-a', 'user-b'],
        listingId: DIRECT_CONVERSATION_LISTING_ID,
        unreadCounts: { 'user-a': 0, 'user-b': 2 },
        lastMessage: 'Xin chào',
      }),
    );

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(conversationModel.create).not.toHaveBeenCalled();
    expect(result.id).toBe('conversation-id');
    expect(result.unreadCount).toBe(0);
  });

  it('reuses the single conversation of the pair for any listing or none, without writing the listing', async () => {
    conversationModel.findOne.mockReturnValue(
      sortedQueryReturning({
        _id: 'the-thread',
        participantIds: ['user-a', 'user-b'],
        participantKey: 'user-a:user-b',
        listingId: DIRECT_CONVERSATION_LISTING_ID,
        participantRoles: { 'user-a': 'LANDLORD', 'user-b': 'TENANT' },
        unreadCounts: {},
      }),
    );

    const first = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      listing: listing('listing-1'),
    } as never);
    const second = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      listing: listing('listing-2'),
    } as never);
    const third = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect([first.id, second.id, third.id]).toEqual([
      'the-thread',
      'the-thread',
      'the-thread',
    ]);
    expect(conversationModel.findOne).toHaveBeenCalledWith({
      participantKey: 'user-a:user-b',
    });
    expect(conversationModel.create).not.toHaveBeenCalled();
    // existing roles are kept: nothing is written at all
    expect(conversationModel.updateOne).not.toHaveBeenCalled();
  });

  it('seeds roles on a listing chat only when the pair has none', async () => {
    conversationModel.findOne.mockReturnValueOnce(
      sortedQueryReturning({
        _id: 'the-thread',
        participantIds: ['user-a', 'user-b'],
        participantRoles: {},
        unreadCounts: {},
      }),
    );
    conversationModel.updateOne.mockReturnValueOnce(queryReturning({}));

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      listing: listing('listing-1'),
    } as never);

    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'the-thread' },
      {
        $set: {
          'participantRoles.user-a': 'TENANT',
          'participantRoles.user-b': 'LANDLORD',
        },
      },
    );
    expect(result.participantRole).toBe('LANDLORD');
  });

  it('creates a direct-keyed conversation with seeded roles and no listing for a listing chat', async () => {
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));
    conversationModel.create.mockResolvedValueOnce({
      _id: 'new-thread',
      participantIds: ['user-a', 'user-b'],
      unreadCounts: {},
    });

    await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
      listing: listing('listing-2'),
    } as never);

    const created = conversationModel.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(created).toMatchObject({
      listingId: DIRECT_CONVERSATION_LISTING_ID,
      participantRoles: { 'user-a': 'TENANT', 'user-b': 'LANDLORD' },
    });
    expect(created).not.toHaveProperty('listing');
  });

  it('returns the concurrently created conversation on a duplicate-key error', async () => {
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));
    conversationModel.create.mockRejectedValueOnce({ code: 11000 });
    conversationModel.findOne.mockReturnValueOnce(
      sortedQueryReturning({
        _id: 'winner',
        participantIds: ['user-a', 'user-b'],
        unreadCounts: {},
      }),
    );

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(result.id).toBe('winner');
  });

  it('rethrows a duplicate-key error when nothing can be re-read', async () => {
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));
    conversationModel.create.mockRejectedValueOnce({ code: 11000 });
    conversationModel.findOne.mockReturnValueOnce(sortedQueryReturning(null));

    await expect(
      service.createOrReuseConversation('user-a', { participantId: 'user-b' }),
    ).rejects.toEqual({ code: 11000 });
  });

  it('hides an empty direct thread when the same pair has another conversation, but keeps it otherwise', async () => {
    const row = (
      id: string,
      key: string,
      listingId: string,
      lastMessageAt?: Date,
    ) => ({
      _id: id,
      participantIds: key.split(':'),
      participantKey: key,
      listingId,
      lastMessageAt,
      unreadCounts: {},
    });
    const found = [
      row('real', 'user-a:user-b', 'listing-1', new Date()),
      row('empty-dup', 'user-a:user-b', DIRECT_CONVERSATION_LISTING_ID),
      row('empty-alone', 'user-a:user-c', DIRECT_CONVERSATION_LISTING_ID),
    ];
    conversationModel.find.mockReturnValueOnce({
      sort: () => ({ limit: () => queryReturning(found) }),
    });
    conversationModel.distinct.mockReturnValueOnce(
      queryReturning(['user-a:user-b']),
    );

    const result = await service.listConversations('user-a');

    expect(result.map((item) => item.id)).toEqual(['real', 'empty-alone']);
    expect(conversationModel.distinct).toHaveBeenCalledWith(
      'participantKey',
      expect.objectContaining({
        listingId: { $ne: DIRECT_CONVERSATION_LISTING_ID },
      }),
    );
  });

  it('hides empty legacy threads next to one with messages but never a thread that has messages', async () => {
    const row = (id: string, listingId: string, lastMessageAt?: Date) => ({
      _id: id,
      participantIds: ['user-a', 'user-b'],
      participantKey: 'user-a:user-b',
      listingId,
      lastMessageAt,
      unreadCounts: {},
    });
    const found = [
      row('with-messages-1', 'listing-1', new Date('2026-02-01')),
      row('empty-listing-thread', 'listing-2'),
      row('with-messages-2', 'listing-3', new Date('2026-01-01')),
    ];
    conversationModel.find.mockReturnValueOnce({
      sort: () => ({ limit: () => queryReturning(found) }),
    });

    const result = await service.listConversations('user-a');

    expect(result.map((item) => item.id)).toEqual([
      'with-messages-1',
      'with-messages-2',
    ]);
  });

  it('fills a missing participant profile when an existing conversation is reopened', async () => {
    conversationModel.findOne.mockReturnValueOnce(
      sortedQueryReturning({
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
      service.getParticipantOrThrow('507f1f77bcf86cd799439011', 'user-c'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns not found for an invalid Mongo conversation id', async () => {
    await expect(
      service.getParticipantOrThrow('not-an-object-id', 'user-a'),
    ).rejects.toThrow(NotFoundException);
    expect(conversationModel.findOne).not.toHaveBeenCalled();
  });

  it('returns only candidates sharing a conversation with the requester', async () => {
    conversationModel.distinct.mockReturnValueOnce(
      queryReturning(['user-a', 'user-b', 'user-x']),
    );

    const result = await service.findSharedParticipantIds('user-a', [
      'user-b',
      'stranger',
    ]);

    expect(result).toEqual(['user-b']);
    expect(conversationModel.distinct).toHaveBeenCalledWith('participantIds', {
      $and: [
        { participantIds: 'user-a' },
        { participantIds: { $in: ['user-b', 'stranger'] } },
      ],
    });
    await expect(
      service.findSharedParticipantIds('user-a', []),
    ).resolves.toEqual([]);
  });
});
