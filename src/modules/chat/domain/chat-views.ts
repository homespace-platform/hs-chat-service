import type { RelatedListingSnapshot } from './related-listing-snapshot';

export interface ConversationView {
  id: string;
  participantId: string;
  participantName?: string;
  participantEmail?: string;
  listing?: RelatedListingSnapshot;
  lastMessage?: string;
  lastMessageAt?: Date;
  lastMessageSenderId?: string;
  unreadCount: number;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  listing?: RelatedListingSnapshot;
  createdAt: Date;
}

export interface MessagePage {
  items: MessageView[];
  nextBefore?: string;
}
