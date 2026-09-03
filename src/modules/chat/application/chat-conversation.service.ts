import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  buildParticipantKey,
  DIRECT_CONVERSATION_LISTING_ID,
} from './conversation-key';
import { CreateConversationDto } from './dto/create-conversation.dto';
import type { RelatedListingDto } from './dto/related-listing.dto';
import type { ConversationView } from '../domain/chat-views';
import type { RelatedListingSnapshot } from '../domain/related-listing-snapshot';
import type { ParticipantProfileSnapshot } from '../domain/participant-profile-snapshot';
import {
  Conversation,
  type ConversationDocument,
} from '../infrastructure/persistence/schemas/conversation.schema';

@Injectable()
export class ChatConversationService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
  ) {}

  async createOrReuseConversation(
    currentUserId: string,
    input: CreateConversationDto,
  ): Promise<ConversationView> {
    let participantKey: string;
    try {
      participantKey = buildParticipantKey(currentUserId, input.participantId);
    } catch {
      throw new BadRequestException(
        'A conversation requires two different users',
      );
    }

    const listingId = input.listing?.id ?? DIRECT_CONVERSATION_LISTING_ID;
    const filter = { participantKey, listingId };
    const existing = await this.conversationModel.findOne(filter).exec();
    if (existing) {
      if (input.participantProfile) {
        const participantProfile = this.toParticipantProfile(
          input.participantProfile,
        );
        await this.conversationModel
          .updateOne(
            { _id: existing._id },
            {
              $set: {
                [`participantProfiles.${input.participantId}`]:
                  participantProfile,
              },
            },
          )
          .exec();
        existing.participantProfiles = {
          ...existing.participantProfiles,
          [input.participantId]: participantProfile,
        };
      }
      return this.toView(existing, currentUserId);
    }

    try {
      const created = await this.conversationModel.create({
        participantIds: [currentUserId, input.participantId]
          .map((id) => id.trim())
          .sort(),
        participantKey,
        listingId,
        listing: input.listing
          ? this.toListingSnapshot(input.listing)
          : undefined,
        unreadCounts: {
          [currentUserId]: 0,
          [input.participantId]: 0,
        },
        participantProfiles: input.participantProfile
          ? {
              [input.participantId]: this.toParticipantProfile(
                input.participantProfile,
              ),
            }
          : {},
      });
      return this.toView(created, currentUserId);
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const concurrent = await this.conversationModel.findOne(filter).exec();
        if (concurrent) {
          return this.toView(concurrent, currentUserId);
        }
      }
      throw error;
    }
  }

  async listConversations(
    currentUserId: string,
    limit = 30,
  ): Promise<ConversationView[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const conversations = await this.conversationModel
      .find({ participantIds: currentUserId })
      .sort({ updatedAt: -1 })
      .limit(boundedLimit)
      .exec();

    return conversations.map((conversation) =>
      this.toView(conversation, currentUserId),
    );
  }

  async getParticipantOrThrow(
    conversationId: string,
    currentUserId: string,
  ): Promise<ConversationDocument> {
    if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation not found');
    }

    const conversation = await this.conversationModel
      .findOne({ _id: conversationId, participantIds: currentUserId })
      .exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation as ConversationDocument;
  }

  toView(
    conversation: ConversationDocument,
    currentUserId: string,
  ): ConversationView {
    const participantId = conversation.participantIds.find(
      (id) => id !== currentUserId,
    );
    const profile = participantId
      ? conversation.participantProfiles?.[participantId]
      : undefined;

    return {
      id: conversation._id.toString(),
      participantId: participantId ?? '',
      participantName: profile?.displayName,
      participantEmail: profile?.email,
      participantAvatar: profile?.avatarUrl,
      listing: conversation.listing,
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
      lastMessageSenderId: conversation.lastMessageSenderId,
      unreadCount: conversation.unreadCounts?.[currentUserId] ?? 0,
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
    profile: NonNullable<CreateConversationDto['participantProfile']>,
  ): ParticipantProfileSnapshot {
    return {
      displayName: profile.displayName?.trim(),
      email: profile.email?.trim(),
      avatarUrl: profile.avatarUrl?.trim(),
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
