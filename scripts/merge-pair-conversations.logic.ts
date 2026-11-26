// Pure planning logic for scripts/merge-pair-conversations.ts (no DB access, unit-tested).

export interface ListingSnapshot {
  id: string;
  [key: string]: unknown;
}

export interface ConversationRow {
  id: string;
  participantKey: string;
  listingId?: string;
  listing?: ListingSnapshot | null;
  lastMessageAt?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
  unreadCounts?: Record<string, number> | null;
  participantProfiles?: Record<string, unknown> | null;
  participantRoles?: Record<string, string> | null;
}

export interface PairEntry {
  conversation: ConversationRow;
  messageCount: number;
  /** Oldest message of the conversation, if any. */
  earliest?: { id: string; hasListing: boolean; recalled: boolean };
  /** Newest message of the conversation (hidden-for ignored on purpose), if any. */
  newest?: { content: string; createdAt: Date; senderId: string };
}

export interface PairPlan {
  participantKey: string;
  survivorId: string;
  mergedIds: string[];
  messageCounts: Record<string, number>;
  /** Messages that must receive the conversation's old listing card, so it stays in the thread. */
  listingSeeds: { messageId: string; listing: ListingSnapshot }[];
  survivorSet: {
    unreadCounts: Record<string, number>;
    participantProfiles: Record<string, unknown>;
    participantRoles: Record<string, string>;
    listingId: string;
    lastMessage?: string;
    lastMessageAt?: Date;
    lastMessageSenderId?: string;
  };
}

const time = (value?: Date | null) => (value ? value.getTime() : 0);

/** Most recent lastMessageAt (fallback updatedAt); ties: oldest createdAt, then id. */
export function pickSurvivor(entries: PairEntry[]): PairEntry {
  return [...entries].sort((a, b) => {
    const left = a.conversation;
    const right = b.conversation;
    return (
      time(right.lastMessageAt ?? right.updatedAt) -
        time(left.lastMessageAt ?? left.updatedAt) ||
      time(left.createdAt) - time(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  })[0];
}

export function planPairMerge(
  entries: PairEntry[],
  directListingId: string,
): PairPlan {
  if (!entries.length) throw new Error('A pair needs at least one conversation');
  const survivor = pickSurvivor(entries);
  const others = entries.filter((entry) => entry !== survivor);

  const unreadCounts: Record<string, number> = {};
  for (const { conversation } of entries) {
    for (const [userId, count] of Object.entries(
      conversation.unreadCounts ?? {},
    )) {
      unreadCounts[userId] = (unreadCounts[userId] ?? 0) + (count || 0);
    }
  }

  // Survivor wins; the others only fill gaps (most recent first).
  const fill = <T>(
    pick: (row: ConversationRow) => Record<string, T> | null | undefined,
  ): Record<string, T> => {
    const merged: Record<string, T> = {};
    for (const { conversation } of [survivor, ...others]) {
      for (const [key, value] of Object.entries(pick(conversation) ?? {})) {
        if (!(key in merged)) merged[key] = value;
      }
    }
    return merged;
  };

  const newest = entries
    .map((entry) => entry.newest)
    .filter((message): message is NonNullable<typeof message> => !!message)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return {
    participantKey: survivor.conversation.participantKey,
    survivorId: survivor.conversation.id,
    mergedIds: others.map((entry) => entry.conversation.id),
    messageCounts: Object.fromEntries(
      entries.map((entry) => [entry.conversation.id, entry.messageCount]),
    ),
    listingSeeds: entries.flatMap(({ conversation, earliest }) =>
      conversation.listing && earliest && !earliest.hasListing && !earliest.recalled
        ? [{ messageId: earliest.id, listing: conversation.listing }]
        : [],
    ),
    survivorSet: {
      unreadCounts,
      participantProfiles: fill((row) => row.participantProfiles),
      participantRoles: fill((row) => row.participantRoles),
      listingId: directListingId,
      ...(newest
        ? {
            lastMessage: newest.content,
            lastMessageAt: newest.createdAt,
            lastMessageSenderId: newest.senderId,
          }
        : {}),
    },
  };
}
