import type { RelatedListingSnapshot } from './related-listing-snapshot';
import type { ChatAttachment } from './chat-attachment';
import type { ChatCall } from './chat-call';
import type { ParticipantRole } from './participant-role';

export interface ConversationView {
  id: string;
  participantId: string;
  participantName?: string;
  participantEmail?: string;
  participantAvatar?: string;
  listing?: RelatedListingSnapshot;
  lastMessage?: string;
  lastMessageAt?: Date;
  lastMessageId?: string;
  lastMessageSenderId?: string;
  unreadCount: number;
  participantRole?: ParticipantRole;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  call?: ChatCall;
  listing?: RelatedListingSnapshot;
  createdAt: Date;
  attachments: ChatAttachment[];
  isPinned: boolean;
  isRecalled: boolean;
}

export interface MessagePage {
  items: MessageView[];
  nextBefore?: string;
}
