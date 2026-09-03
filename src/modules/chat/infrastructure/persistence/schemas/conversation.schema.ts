import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { DIRECT_CONVERSATION_LISTING_ID } from '../../../application/conversation-key';
import type { RelatedListingSnapshot } from '../../../domain/related-listing-snapshot';

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

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ type: [String], required: true, index: true })
  participantIds!: string[];

  @Prop({ required: true })
  participantKey!: string;

  @Prop({ required: true, default: DIRECT_CONVERSATION_LISTING_ID })
  listingId!: string;

  @Prop({ type: RelatedListingSchema })
  listing?: RelatedListingSnapshot;

  @Prop()
  lastMessage?: string;

  @Prop()
  lastMessageAt?: Date;

  @Prop()
  lastMessageSenderId?: string;

  @Prop({ type: Object, default: {} })
  unreadCounts!: Record<string, number>;
}

export type ConversationDocument = HydratedDocument<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index(
  { participantKey: 1, listingId: 1 },
  { unique: true },
);
ConversationSchema.index({ participantIds: 1, updatedAt: -1 });
