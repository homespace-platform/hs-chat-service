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
import type { ParticipantRole } from '../domain/participant-role';
import type { UpdateParticipantRoleDto } from './dto/update-participant-role.dto';
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
    if (existing) return this.reopen(existing, input, currentUserId);

    // A request without a listing must not add a second, empty "direct" thread to a pair that already
    // talks (that is what showed the same person twice): reuse their most recent conversation instead.
    if (!input.listing) {
      const latest = await this.conversationModel
        .findOne({ participantKey })
        .sort({ updatedAt: -1 })
        .exec();
      if (latest) return this.reopen(latest, input, currentUserId);
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
        participantRoles: input.listing
          ? {
              [currentUserId]: 'TENANT' satisfies ParticipantRole,
              [input.participantId]: 'LANDLORD' satisfies ParticipantRole,
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

    // Rows created before the reuse rule above: an empty direct thread next to a real conversation with
    // the same person is noise. Hidden (not deleted); it still opens by id.
    const emptyDirect = conversations.filter(
      (item) =>
        item.listingId === DIRECT_CONVERSATION_LISTING_ID &&
        !item.lastMessageAt,
    );
    let duplicateKeys = new Set<string>();
    if (emptyDirect.length) {
      const keys: string[] = await this.conversationModel
        .distinct('participantKey', {
          participantKey: {
            $in: emptyDirect.map((item) => item.participantKey),
          },
          listingId: { $ne: DIRECT_CONVERSATION_LISTING_ID },
        })
        .exec();
      duplicateKeys = new Set(keys);
    }

    return conversations
      .filter(
        (item) =>
          !emptyDirect.includes(item) ||
          !duplicateKeys.has(item.participantKey),
      )
      .map((conversation) => this.toView(conversation, currentUserId));
  }

  private async reopen(
    conversation: ConversationDocument,
    input: CreateConversationDto,
    currentUserId: string,
  ): Promise<ConversationView> {
    if (input.participantProfile) {
      const participantProfile = this.toParticipantProfile(
        input.participantProfile,
      );
      await this.conversationModel
        .updateOne(
          { _id: conversation._id },
          {
            $set: {
              [`participantProfiles.${input.participantId}`]:
                participantProfile,
            },
          },
        )
        .exec();
      conversation.participantProfiles = {
        ...conversation.participantProfiles,
        [input.participantId]: participantProfile,
      };
    }
    return this.toView(conversation, currentUserId);
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

  /** Subset of candidateIds that share at least one conversation with currentUserId. */
  async findSharedParticipantIds(
    currentUserId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    const participants: string[] = await this.conversationModel
      .distinct('participantIds', {
        $and: [
          { participantIds: currentUserId },
          { participantIds: { $in: candidateIds } },
        ],
      })
      .exec();
    const shared = new Set(participants);
    return candidateIds.filter((id) => shared.has(id));
  }

  async updateParticipantRole(
    conversationId: string,
    currentUserId: string,
    input: UpdateParticipantRoleDto,
  ): Promise<ConversationView> {
    const conversation = await this.getParticipantOrThrow(
      conversationId,
      currentUserId,
    );
    const participantId = conversation.participantIds.find(
      (id) => id !== currentUserId,
    );
    if (!participantId) return this.toView(conversation, currentUserId);

    conversation.participantRoles = {
      ...(conversation.participantRoles ?? {}),
      [participantId]: input.role,
    };
    await conversation.save();
    return this.toView(conversation, currentUserId);
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
      participantRole: participantId
        ? conversation.participantRoles?.[participantId]
        : undefined,
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
