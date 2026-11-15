import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'chat_assets' })
export class ChatAsset {
  @Prop({ type: String }) _id!: string;
  @Prop({ required: true, index: true }) conversationId!: string;
  @Prop({ required: true }) ownerId!: string;
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) contentType!: string;
  @Prop({ required: true }) sizeBytes!: number;
  @Prop({ required: true }) bucketName!: string;
  @Prop({ required: true }) objectKey!: string;
  @Prop({
    required: true,
    enum: ['PENDING', 'READY', 'REJECTED'],
    default: 'PENDING',
  })
  status!: string;
  @Prop({ type: String }) versionId?: string;
}

export type ChatAssetDocument = HydratedDocument<ChatAsset>;
export const ChatAssetSchema = SchemaFactory.createForClass(ChatAsset);
