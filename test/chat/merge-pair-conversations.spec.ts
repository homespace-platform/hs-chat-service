import {
  planPairMerge,
  type PairEntry,
} from '../../scripts/merge-pair-conversations.logic';

const listing = (id: string) => ({ id, title: id });
const entry = (id: string, over: Partial<PairEntry['conversation']> = {}, rest: Partial<PairEntry> = {}): PairEntry => ({
  conversation: { id, participantKey: 'a:b', createdAt: new Date('2026-01-01'), ...over },
  messageCount: 0,
  ...rest,
});

describe('planPairMerge', () => {
  it('keeps the most recently active conversation and merges the rest', () => {
    const old = entry(
      'old',
      {
        listing: listing('l1'),
        lastMessageAt: new Date('2026-02-01'),
        unreadCounts: { a: 1, b: 2 },
        participantProfiles: { b: 'old-profile', a: 'a-profile' },
        participantRoles: { a: 'TENANT', b: 'LANDLORD' },
      },
      {
        messageCount: 2,
        earliest: { id: 'm1', hasListing: false, recalled: false },
        newest: { content: 'older', createdAt: new Date('2026-02-01'), senderId: 'a' },
      },
    );
    const recent = entry(
      'recent',
      {
        listing: listing('l2'),
        lastMessageAt: new Date('2026-03-01'),
        unreadCounts: { a: 4 },
        participantProfiles: { b: 'new-profile' },
        participantRoles: { a: 'LANDLORD' },
      },
      {
        messageCount: 1,
        earliest: { id: 'm2', hasListing: true, recalled: false },
        newest: { content: 'latest', createdAt: new Date('2026-03-01'), senderId: 'b' },
      },
    );

    const plan = planPairMerge([old, recent], '__direct__');

    expect(plan.survivorId).toBe('recent');
    expect(plan.mergedIds).toEqual(['old']);
    expect(plan.messageCounts).toEqual({ old: 2, recent: 1 });
    // m2 already carries a card; only the old thread's first message gets one.
    expect(plan.listingSeeds).toEqual([{ messageId: 'm1', listing: listing('l1') }]);
    expect(plan.survivorSet).toEqual({
      unreadCounts: { a: 5, b: 2 },
      participantProfiles: { b: 'new-profile', a: 'a-profile' },
      participantRoles: { a: 'LANDLORD', b: 'LANDLORD' },
      listingId: '__direct__',
      lastMessage: 'latest',
      lastMessageAt: new Date('2026-03-01'),
      lastMessageSenderId: 'b',
    });
  });

  it('falls back to updatedAt, then oldest createdAt, and skips recalled first messages', () => {
    const empty = entry('empty', { updatedAt: new Date('2026-05-01'), createdAt: new Date('2026-04-01') });
    const twin = entry(
      'twin',
      { updatedAt: new Date('2026-05-01'), createdAt: new Date('2026-03-01'), listing: listing('l') },
      { earliest: { id: 'm', hasListing: false, recalled: true } },
    );

    const plan = planPairMerge([empty, twin], '__direct__');

    expect(plan.survivorId).toBe('twin');
    expect(plan.listingSeeds).toEqual([]);
    expect(plan.survivorSet.lastMessage).toBeUndefined();
  });

  it('is a no-op plan for a lone conversation', () => {
    const plan = planPairMerge([entry('only')], '__direct__');
    expect(plan.mergedIds).toEqual([]);
  });
});
