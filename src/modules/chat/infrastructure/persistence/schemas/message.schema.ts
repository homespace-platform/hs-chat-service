import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { RelatedListingSnapshot } from '../../../domain/related-listing-snapshot';
import type { ChatAttachment } from '../../../domain/chat-attachment';
import type { ParticipantProfileSnapshot } from '../../../domain/participant-profile-snapshot';
import {
  CHAT_CALL_MODES,
  CHAT_CALL_STATUSES,
  type ChatCall,
} from '../../../domain/chat-call';

const RelatedListingSchema = new MongooseSchema<RelatedListingSnapshot>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: String, required: true },
    location: { type: String, required: true },
    image: { type: String, required: true },
    bedrooms: { type: Number },
    area: { type: Number },
    verified: { type: Boolean },
  },
  { _id: false },
);

const ChatAttachmentSchema = new MongooseSchema<ChatAttachment>(
  {
    storageId: { type: String, required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { _id: false },
);

const MessageCallSchema = new MongooseSchema<ChatCall>(
  {
    callId: { type: String, required: true },
    callerId: { type: String, required: true },
    mode: { type: String, enum: CHAT_CALL_MODES, required: true },
    status: { type: String, enum: CHAT_CALL_STATUSES, required: true },
  },
  { _id: false },
);

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Message {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ required: true })
  senderId!: string;

  @Prop({
    required(this: Message) {
      return !this.attachments?.length;
    },
  })
  content!: string;

  @Prop({ type: MessageCallSchema })
  call?: ChatCall;

  @Prop({ type: RelatedListingSchema })
  listing?: RelatedListingSnapshot;

  @Prop({ type: [ChatAttachmentSchema], default: [] })
  attachments!: ChatAttachment[];

  @Prop({ type: [String], default: [] })
  hiddenFor!: string[];

  @Prop({ type: [String], default: [] })
  pinnedBy!: string[];

  @Prop({ type: Date })
  recalledAt?: Date;

  @Prop({ type: Object })
  pendingConversationUpdate?: {
    recipientId: string;
    preview: string;
    hasListing: boolean;
    senderProfile?: ParticipantProfileSnapshot;
  };

  @Prop({ type: String })
  pendingNotificationRecipientId?: string;

  @Prop({ type: Date })
  notificationClaimedUntil?: Date;

  @Prop({ type: Date })
  notificationPublishedAt?: Date;

  createdAt!: Date;
}

export type MessageDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index(
  { createdAt: 1 },
  { partialFilterExpression: { pendingConversationUpdate: { $exists: true } } },
);
MessageSchema.index({ pendingNotificationRecipientId: 1, notificationPublishedAt: 1, notificationClaimedUntil: 1 });
