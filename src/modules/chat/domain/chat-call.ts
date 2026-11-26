export const CHAT_CALL_MODES = ['audio', 'video'] as const;
export const CHAT_CALL_STATUSES = [
  'missed',
  'declined',
  'cancelled',
  'ended',
  'failed',
] as const;

export interface ChatCallKey {
  conversationId: string;
  callId: string;
}

export interface ChatCall {
  callId: string;
  callerId: string;
  mode: (typeof CHAT_CALL_MODES)[number];
  status: (typeof CHAT_CALL_STATUSES)[number];
}
