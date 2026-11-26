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
import type { ConversationView } from '../domain/chat-views';
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

    // One conversation per pair of users, forever: the listing is context of a message, not of the
    // conversation. Legacy duplicates may still exist until the merge script runs; use the most recent.
    const filter = { participantKey };
    const existing = await this.conversationModel
      .findOne(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .exec();
    if (existing) return this.reopen(existing, input, currentUserId);

    try {
      const created = await this.conversationModel.create({
        participantIds: [currentUserId, input.participantId]
          .map((id) => id.trim())
          .sort(),
        participantKey,
        // Constant on purpose: keeps the {participantKey, listingId} unique index guarding concurrent creates.
        listingId: DIRECT_CONVERSATION_LISTING_ID,
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
          ? this.listingRoles(currentUserId, input.participantId)
          : {},
      });
      return this.toView(created, currentUserId);
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const concurrent = await this.conversationModel
          .findOne(filter)
          .sort({ lastMessageAt: -1, updatedAt: -1 })
          .exec();
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

    // Empty rows next to a conversation with messages for the same pair are noise too (legacy per-listing
    // threads). Non-empty threads are never hidden: that would hide their messages until the merge script runs.
    const keysWithMessages = new Set(
      conversations
        .filter((item) => item.lastMessageAt)
        .map((item) => item.participantKey),
    );

    return conversations
      .filter(
        (item) =>
          !(
            !item.lastMessageAt &&
            (keysWithMessages.has(item.participantKey) ||
              (emptyDirect.includes(item) &&
                duplicateKeys.has(item.participantKey)))
          ),
      )
      .map((conversation) => this.toView(conversation, currentUserId));
  }

  private async reopen(
    conversation: ConversationDocument,
    input: CreateConversationDto,
    currentUserId: string,
  ): Promise<ConversationView> {
    const set: Record<string, unknown> = {};
    if (input.participantProfile) {
      const participantProfile = this.toParticipantProfile(
        input.participantProfile,
      );
      set[`participantProfiles.${input.participantId}`] = participantProfile;
      conversation.participantProfiles = {
        ...conversation.participantProfiles,
        [input.participantId]: participantProfile,
      };
    }
    // Roles come from the first listing chat only; never overwrite what a user already chose.
    const roles = conversation.participantRoles ?? {};
    if (
      input.listing &&
      !roles[currentUserId] &&
      !roles[input.participantId]
    ) {
      const seeded = this.listingRoles(currentUserId, input.participantId);
      for (const [id, role] of Object.entries(seeded)) {
        set[`participantRoles.${id}`] = role;
      }
      conversation.participantRoles = { ...roles, ...seeded };
    }
    if (Object.keys(set).length) {
      await this.conversationModel
        .updateOne({ _id: conversation._id }, { $set: set })
        .exec();
    }
    return this.toView(conversation, currentUserId);
  }

  private listingRoles(
    currentUserId: string,
    participantId: string,
  ): Record<string, ParticipantRole> {
    return {
      [currentUserId]: 'TENANT',
      [participantId]: 'LANDLORD',
    };
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
      ...(conversation.lastMessageId && {
        lastMessageId: conversation.lastMessageId.toString(),
      }),
      lastMessageSenderId: conversation.lastMessageSenderId,
      unreadCount: conversation.unreadCounts?.[currentUserId] ?? 0,
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
