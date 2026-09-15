import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { RelatedListingSnapshot } from '../../../domain/related-listing-snapshot';
import type { ChatAttachment } from '../../../domain/chat-attachment';

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

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Message {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ required: true })
  senderId!: string;

  @Prop({ required: true })
  content!: string;

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

  createdAt!: Date;
}

export type MessageDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: 1 });
