import {
  buildParticipantKey,
  DIRECT_CONVERSATION_LISTING_ID,
} from '../../src/modules/chat/application/conversation-key';

describe('buildParticipantKey', () => {
  it('sorts IDs so both request orders produce the same key', () => {
    expect(buildParticipantKey('user-b', 'user-a')).toBe('user-a:user-b');
    expect(buildParticipantKey('user-a', 'user-b')).toBe('user-a:user-b');
  });

  it('rejects a self-conversation', () => {
    expect(() => buildParticipantKey('user-a', 'user-a')).toThrow();
  });

  it('uses a stable sentinel for conversations without a listing', () => {
    expect(DIRECT_CONVERSATION_LISTING_ID).toBe('__direct__');
  });
});
