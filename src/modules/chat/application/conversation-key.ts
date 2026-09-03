export const DIRECT_CONVERSATION_LISTING_ID = '__direct__';

export function buildParticipantKey(
  firstUserId: string,
  secondUserId: string,
): string {
  const ids = [firstUserId.trim(), secondUserId.trim()];

  if (ids.some((id) => !id) || ids[0] === ids[1]) {
    throw new Error('A conversation requires two different users');
  }

  return ids.sort().join(':');
}
