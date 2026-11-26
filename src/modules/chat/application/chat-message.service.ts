import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import type { ChatCall } from '../domain/chat-call';
import type { MessagePage, MessageView } from '../domain/chat-views';
import type { RelatedListingSnapshot } from '../domain/related-listing-snapshot';
import type { ParticipantProfileSnapshot } from '../domain/participant-profile-snapshot';
import {
  Conversation,
  type ConversationDocument,
} from '../infrastructure/persistence/schemas/conversation.schema';
import {
  Message,
  type MessageDocument,
} from '../infrastructure/persistence/schemas/message.schema';
import { ChatConversationService } from './chat-conversation.service';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { RelatedListingDto } from './dto/related-listing.dto';
import { ChatMediaService } from './chat-media.service';
import { ChatMessageBroadcaster } from './chat-message-broadcaster';
import { ChatNotificationPublisher } from './chat-notification-publisher';

const CALL_CONTENT: Record<ChatCall['status'], string> = {
  missed: 'Cuộc gọi nhỡ',
  declined: 'Cuộc gọi bị từ chối',
  cancelled: 'Cuộc gọi đã hủy',
  ended: 'Cuộc gọi đã kết thúc',
  failed: 'Cuộc gọi thất bại',
};

@Injectable()
export class ChatMessageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatMessageService.name);
  private recoveryTimer?: NodeJS.Timeout;
  private recovering = false;

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    private readonly conversationService: ChatConversationService,
    private readonly media: ChatMediaService,
    private readonly broadcaster: ChatMessageBroadcaster,
    private readonly notificationPublisher: ChatNotificationPublisher,
  ) {}

  onModuleInit() {
    this.recoveryTimer = setInterval(
      () => void this.recoverConversationUpdates(),
      5_000,
    );
    void this.recoverConversationUpdates();
  }

  onModuleDestroy() {
    clearInterval(this.recoveryTimer);
  }

  async sendMessage(
    currentUserId: string,
    conversationId: string,
    input: SendMessageDto,
  ): Promise<MessageView> {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const content = input.content?.trim() ?? '';

    const recipientId = conversation.participantIds.find(
      (id) => id !== currentUserId,
    );
    if (!recipientId) {
      throw new BadRequestException('Conversation has no recipient');
    }

    const attachments = await this.media.resolveAttachments(
      currentUserId,
      conversationId,
      input.attachments,
    );
    if (!content && attachments.length === 0) {
      throw new BadRequestException(
        'Message content or attachment is required',
      );
    }
    const created = await this.messageModel.create({
      conversationId: conversation._id,
      senderId: currentUserId,
      pendingNotificationRecipientId: recipientId,
      content,
      listing: input.listing
        ? this.toListingSnapshot(input.listing)
        : undefined,
      attachments,
      pendingConversationUpdate: {
        recipientId,
        preview: content || attachments[0].fileName,
        hasListing: Boolean(input.listing),
        senderProfile: input.senderProfile
          ? this.toParticipantProfile(input.senderProfile)
          : undefined,
      },
    });
    let syncTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.syncConversation(created, conversation),
        new Promise<void>((resolve) => {
          syncTimeout = setTimeout(resolve, 1_500);
        }),
      ]);
    } finally {
      clearTimeout(syncTimeout);
    }

    return this.toView(created, currentUserId);
  }

  private async recoverConversationUpdates() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const pending = await this.messageModel
        .find({ pendingConversationUpdate: { $exists: true } })
        .sort({ createdAt: 1 })
        .limit(100)
        .exec();
      for (const message of pending) await this.syncConversation(message);
    } catch {
      this.logger.warn('Could not scan for pending chat conversation updates');
    } finally {
      this.recovering = false;
    }
  }

  private async syncConversation(
    message: MessageDocument,
    initial?: ConversationDocument,
  ) {
    const update = message.pendingConversationUpdate;
    if (!update) return;
    const { _id: messageId, conversationId, senderId, createdAt } = message;
    const { recipientId, preview, hasListing, senderProfile } = update;
    const conversationFilter = {
      _id: conversationId,
      participantIds: { $all: [senderId, recipientId] },
    };
    const unread = `unreadCounts.${recipientId}`;
    const senderRole = `participantRoles.${senderId}`;
    const recipientRole = `participantRoles.${recipientId}`;
    const isLatest = {
      $or: [
        { $lt: [{ $ifNull: ['$lastMessageAt', null] }, createdAt] },
        {
          $and: [
            { $eq: ['$lastMessageAt', createdAt] },
            { $lt: [{ $ifNull: ['$lastMessageId', null] }, messageId] },
          ],
        },
      ],
    };
    const seedRoles = {
      $and: [
        { $eq: [{ $ifNull: [`$${senderRole}`, null] }, null] },
        { $eq: [{ $ifNull: [`$${recipientRole}`, null] }, null] },
      ],
    };

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const conversation =
          attempt === 0 && initial
            ? initial
            : await this.conversationModel.findOne(conversationFilter).exec();
        if (!conversation) break;
        const previous = conversation.lastAppliedMessageId;

        // Confirm the previous write before replacing its ID. A retry can then tell whether it already counted this message.
        if (previous) {
          await this.finishConversationUpdate(conversationId, previous);
          if (previous.equals(messageId)) return;
        }
        if (
          !(attempt === 0 && initial) &&
          !(await this.messageModel
            .exists({
              _id: messageId,
              conversationId,
              pendingConversationUpdate: { $exists: true },
            })
            .exec())
        )
          return;

        const result = await this.conversationModel
          .updateOne(
            { ...conversationFilter, lastAppliedMessageId: previous ?? null },
            [
              {
                $set: {
                  lastAppliedMessageId: messageId,
                  lastMessageId: {
                    $cond: [isLatest, messageId, '$lastMessageId'],
                  },
                  lastMessage: {
                    $cond: [isLatest, { $literal: preview }, '$lastMessage'],
                  },
                  lastMessageAt: {
                    $cond: [isLatest, createdAt, '$lastMessageAt'],
                  },
                  lastMessageSenderId: {
                    $cond: [
                      isLatest,
                      { $literal: senderId },
                      '$lastMessageSenderId',
                    ],
                  },
                  updatedAt: { $cond: [isLatest, '$$NOW', '$updatedAt'] },
                  [unread]: {
                    $add: [
                      { $ifNull: [`$${unread}`, 0] },
                      {
                        $cond: [
                          {
                            $lt: [
                              { $ifNull: [`$lastReadAt.${recipientId}`, null] },
                              createdAt,
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                  ...(senderProfile
                    ? {
                        [`participantProfiles.${senderId}`]: {
                          $literal: senderProfile,
                        },
                      }
                    : {}),
                  ...(hasListing
                    ? {
                        [senderRole]: {
                          $cond: [seedRoles, 'TENANT', `$${senderRole}`],
                        },
                        [recipientRole]: {
                          $cond: [seedRoles, 'LANDLORD', `$${recipientRole}`],
                        },
                      }
                    : {}),
                },
              },
            ],
            { updatePipeline: true, timestamps: false },
          )
          .exec();
        if (result.matchedCount) {
          await this.finishConversationUpdate(conversationId, messageId);
          return;
        }
      }
    } catch {
      // The message was saved. Recovery can resume either side of the conversation write.
    }
    this.logger.warn(
      `Chat conversation update pending for message ${messageId}`,
    );
  }

  private async finishConversationUpdate(
    conversationId: Types.ObjectId,
    messageId: Types.ObjectId,
  ) {
    const message = await this.messageModel
      .findOneAndUpdate(
        {
          _id: messageId,
          conversationId,
          pendingConversationUpdate: { $exists: true },
        },
        { $unset: { pendingConversationUpdate: 1 } },
        { returnDocument: 'before' },
      )
      .exec();
    const recipientId = message?.pendingConversationUpdate?.recipientId;
    if (message && recipientId) {
      this.broadcaster.broadcast(
        this.toView(message, message.senderId),
        message.senderId,
        recipientId,
      );
      this.notificationPublisher.wake();
    }
  }

  async publishCall(
    messageId: Types.ObjectId,
    conversationId: Types.ObjectId,
    recipientId: string,
    call: ChatCall,
    createdAt: Date,
  ) {
    const senderId = call.callerId;
    const content = CALL_CONTENT[call.status];
    const message = await this.messageModel
      .findOneAndUpdate(
        { _id: messageId },
        { $setOnInsert: { conversationId, senderId, content, call, createdAt } },
        { upsert: true, returnDocument: 'after', overwriteImmutable: true },
      )
      .exec();

    // The timestamp guard makes retries safe and preserves newer previews.
    await this.conversationModel
      .updateOne(
        {
          _id: conversationId,
          participantIds: { $all: [senderId, recipientId] },
          $or: [
            { lastMessageAt: null },
            { lastMessageAt: { $lt: createdAt } },
            {
              lastMessageAt: createdAt,
              $or: [{ lastMessageId: null }, { lastMessageId: { $lt: messageId } }],
            },
          ],
        },
        {
          $set: {
            lastMessage: message.content,
            lastMessageAt: createdAt,
            lastMessageSenderId: senderId,
            lastMessageId: messageId,
          },
          $inc: { [`unreadCounts.${recipientId}`]: 1 },
        },
      )
      .exec();
    this.broadcaster.broadcast(
      this.toView(message, senderId),
      senderId,
      recipientId,
    );
  }

  async listMessages(
    currentUserId: string,
    conversationId: string,
    query: ListMessagesDto,
  ): Promise<MessagePage> {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const filter: Record<string, unknown> = {
      conversationId: conversation._id,
      hiddenFor: { $ne: currentUserId },
    };
    if (query.before) {
      const before = new Date(query.before);
      if (Number.isNaN(before.getTime())) {
        throw new BadRequestException('Invalid before timestamp');
      }
      filter.createdAt = { $lt: before };
    }
    if (query.search?.trim()) {
      filter.content = {
        $regex: query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }
    if (query.media === 'images') {
      filter['attachments.contentType'] = /^image\//;
    }

    const messages = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();

    return {
      items: page.map((message) => this.toView(message, currentUserId)),
      nextBefore: hasMore ? page[0]?.createdAt.toISOString() : undefined,
    };
  }

  async markRead(currentUserId: string, conversationId: string) {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    await this.conversationModel
      .updateOne(
        { _id: conversation._id, participantIds: currentUserId },
        {
          $set: { [`unreadCounts.${currentUserId}`]: 0 },
          $currentDate: { [`lastReadAt.${currentUserId}`]: true },
        },
      )
      .exec();

    return {
      ...this.conversationService.toView(conversation, currentUserId),
      unreadCount: 0,
    };
  }

  async setPinned(
    currentUserId: string,
    conversationId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<MessageView> {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const message = await this.messageModel
      .findOneAndUpdate(
        {
          _id: messageId,
          conversationId: conversation._id,
          recalledAt: { $exists: false },
        },
        pinned
          ? { $addToSet: { pinnedBy: currentUserId } }
          : { $pull: { pinnedBy: currentUserId } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!message) throw new NotFoundException('Message not found');
    return this.toView(message, currentUserId);
  }

  async deleteForUser(
    currentUserId: string,
    conversationId: string,
    messageId: string,
  ) {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const result = await this.messageModel
      .updateOne(
        { _id: messageId, conversationId: conversation._id },
        {
          $addToSet: { hiddenFor: currentUserId },
          $pull: { pinnedBy: currentUserId },
        },
      )
      .exec();
    if (!result.matchedCount) throw new NotFoundException('Message not found');
    return { conversationId, messageId };
  }

  async recall(
    currentUserId: string,
    conversationId: string,
    messageId: string,
  ) {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const message = await this.messageModel
      .findOneAndUpdate(
        {
          _id: messageId,
          conversationId: conversation._id,
          senderId: currentUserId,
          recalledAt: { $exists: false },
          createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
        {
          $set: {
            content: 'Tin nhắn đã được thu hồi',
            attachments: [],
            pinnedBy: [],
            recalledAt: new Date(),
          },
          $unset: { listing: 1, call: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!message) {
      throw new NotFoundException(
        'Message not found, already recalled, or recall window expired',
      );
    }
    return {
      message: this.toView(message, currentUserId),
      participantIds: conversation.participantIds,
    };
  }

  private toView(message: MessageDocument, currentUserId: string): MessageView {
    return {
      id: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId,
      content: message.content,
      ...(message.call && { call: message.call }),
      listing: message.listing,
      attachments: message.attachments ?? [],
      createdAt: message.createdAt,
      isPinned: (message.pinnedBy ?? []).includes(currentUserId),
      isRecalled: Boolean(message.recalledAt),
    };
  }

  private toListingSnapshot(
    listing: RelatedListingDto,
  ): RelatedListingSnapshot {
    return {
      id: listing.id.trim(),
      title: listing.title.trim(),
      price: listing.price.trim(),
      location: listing.location.trim(),
      image: listing.image.trim(),
      bedrooms: listing.bedrooms,
      area: listing.area,
      verified: listing.verified,
    };
  }

  private toParticipantProfile(
    profile: NonNullable<SendMessageDto['senderProfile']>,
  ): ParticipantProfileSnapshot {
    return {
      displayName: profile.displayName?.trim(),
      email: profile.email?.trim(),
      avatarUrl: profile.avatarUrl?.trim(),
    };
  }
}
