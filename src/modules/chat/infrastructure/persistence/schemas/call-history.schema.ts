import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  CHAT_CALL_MODES,
  CHAT_CALL_STATUSES,
  type ChatCall,
} from '../../../domain/chat-call';

@Schema()
export class CallHistory {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: Types.ObjectId, required: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  messageId!: Types.ObjectId;

  @Prop({ required: true })
  callId!: string;

  @Prop({ required: true })
  callerId!: string;

  @Prop({ required: true })
  calleeId!: string;

  @Prop({ type: String, enum: CHAT_CALL_MODES, required: true })
  mode!: ChatCall['mode'];

  @Prop({ type: Date, required: true })
  deadlineAt!: Date;

  @Prop({ type: Date })
  acceptedAt?: Date;

  @Prop({ type: String, enum: CHAT_CALL_STATUSES })
  status?: ChatCall['status'];

  @Prop({ type: Date })
  finishedAt?: Date;

  // The recovery worker handles ringing deadlines and unpublished outcomes.
  @Prop({ type: Date, index: { sparse: true } })
  pendingAt?: Date;
}

export type CallHistoryDocument = HydratedDocument<CallHistory>;
export const CallHistorySchema = SchemaFactory.createForClass(CallHistory);
