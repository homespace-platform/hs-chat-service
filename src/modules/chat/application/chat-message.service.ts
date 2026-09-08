import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { MessagePage, MessageView } from '../domain/chat-views';
import type { RelatedListingSnapshot } from '../domain/related-listing-snapshot';
import type { ParticipantProfileSnapshot } from '../domain/participant-profile-snapshot';
import {
  Conversation,
} from '../infrastructure/persistence/schemas/conversation.schema';
import {
  Message,
  type MessageDocument,
} from '../infrastructure/persistence/schemas/message.schema';
import { ChatConversationService } from './chat-conversation.service';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { RelatedListingDto } from './dto/related-listing.dto';

@Injectable()
export class ChatMessageService {
  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    private readonly conversationService: ChatConversationService,
  ) {}

  async sendMessage(
    currentUserId: string,
    conversationId: string,
    input: SendMessageDto,
  ): Promise<MessageView> {
    const conversation = await this.conversationService.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const content = input.content.trim();
    if (!content) {
      throw new BadRequestException('Message content is required');
    }

    const recipientId = conversation.participantIds.find(
      (id) => id !== currentUserId,
    );
    if (!recipientId) {
      throw new BadRequestException('Conversation has no recipient');
    }

    const created = await this.messageModel.create({
      conversationId: conversation._id,
      senderId: currentUserId,
      content,
      listing: input.listing
        ? this.toListingSnapshot(input.listing)
        : undefined,
      attachments: input.attachments ?? [],
    });
    const createdAt = created.createdAt ?? new Date();

    await this.conversationModel
      .updateOne(
        { _id: conversation._id, participantIds: currentUserId },
        {
          $set: {
            lastMessage: content,
            lastMessageAt: createdAt,
            lastMessageSenderId: currentUserId,
            ...(input.senderProfile
              ? {
                  [`participantProfiles.${currentUserId}`]:
                    this.toParticipantProfile(input.senderProfile),
                }
              : {}),
          },
          $inc: { [`unreadCounts.${recipientId}`]: 1 },
        },
      )
      .exec();

    return this.toView(created);
  }

  async listMessages(
    currentUserId: string,
    conversationId: string,
    query: ListMessagesDto,
  ): Promise<MessagePage> {
    const conversation =
      await this.conversationService.getParticipantOrThrow(
        conversationId,
        currentUserId,
      );
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const filter: Record<string, unknown> = {
      conversationId: conversation._id,
    };
    if (query.before) {
      const before = new Date(query.before);
      if (Number.isNaN(before.getTime())) {
        throw new BadRequestException('Invalid before timestamp');
      }
      filter.createdAt = { $lt: before };
    }

    const messages = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();

    return {
      items: page.map((message) => this.toView(message)),
      nextBefore: hasMore
        ? page[0]?.createdAt.toISOString()
        : undefined,
    };
  }

  async markRead(
    currentUserId: string,
    conversationId: string,
  ) {
    const conversation =
      await this.conversationService.getParticipantOrThrow(
        conversationId,
        currentUserId,
      );
    await this.conversationModel
      .updateOne(
        { _id: conversation._id, participantIds: currentUserId },
        { $set: { [`unreadCounts.${currentUserId}`]: 0 } },
      )
      .exec();

    return {
      ...this.conversationService.toView(conversation, currentUserId),
      unreadCount: 0,
    };
  }

  private toView(message: MessageDocument): MessageView {
    return {
      id: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId,
      content: message.content,
      listing: message.listing,
      attachments: message.attachments ?? [],
      createdAt: message.createdAt,
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
