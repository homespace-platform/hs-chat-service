import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ChatConversationService } from './chat-conversation.service';
import {
  ChatAsset,
  type ChatAssetDocument,
} from '../infrastructure/persistence/schemas/chat-asset.schema';
import { Message } from '../infrastructure/persistence/schemas/message.schema';
import {
  CHAT_FILE_TYPES,
  type CreateChatUploadDto,
} from './dto/chat-upload.dto';
import type { ChatAttachment } from '../domain/chat-attachment';

@Injectable()
export class ChatMediaService {
  private readonly bucket?: string;
  constructor(
    @InjectModel(ChatAsset.name) private readonly assets: Model<ChatAsset>,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    private readonly conversations: ChatConversationService,
    private readonly s3: S3Client,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>('AWS_S3_BUCKET');
  }

  async createUpload(
    userId: string,
    conversationId: string,
    input: CreateChatUploadDto,
  ) {
    await this.conversations.getParticipantOrThrow(conversationId, userId);
    if (!this.bucket)
      throw new ServiceUnavailableException(
        'Chat file storage is not configured',
      );
    const extension = Object.hasOwn(CHAT_FILE_TYPES, input.contentType)
      ? CHAT_FILE_TYPES[input.contentType as keyof typeof CHAT_FILE_TYPES]
      : undefined;
    if (
      !extension ||
      !Number.isInteger(input.size) ||
      input.size < 1 ||
      input.size > 25 * 1024 * 1024 ||
      !input.fileName?.trim() ||
      input.fileName.length > 512
    )
      throw new BadRequestException('Invalid chat attachment');
    const storageId = `chat_${randomUUID()}`;
    const objectKey = `private/chat/${conversationId}/${storageId}.${extension}`;
    const uploadUrl = await this.sign(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      600,
    );
    await this.assets.create({
      _id: storageId,
      conversationId,
      ownerId: userId,
      fileName: input.fileName.trim(),
      contentType: input.contentType,
      sizeBytes: input.size,
      bucketName: this.bucket,
      objectKey,
      status: 'PENDING',
    });
    return {
      storageId,
      uploadUrl,
      method: 'PUT',
      expiresAt: new Date(Date.now() + 600_000),
    };
  }

  async completeUpload(
    userId: string,
    conversationId: string,
    storageId: string,
  ) {
    await this.conversations.getParticipantOrThrow(conversationId, userId);
    const asset = await this.assets
      .findOne({ _id: storageId, conversationId, ownerId: userId })
      .exec();
    if (!asset) throw new NotFoundException('Chat attachment not found');
    if (asset.status === 'READY') return this.toAttachment(asset);
    if (asset.status !== 'PENDING')
      throw new BadRequestException('Invalid chat attachment');
    const head = await this.s3
      .send(
        new HeadObjectCommand({
          Bucket: asset.bucketName,
          Key: asset.objectKey,
        }),
      )
      .catch(() => {
        throw new ServiceUnavailableException('Cannot verify chat upload');
      });
    if (
      head.ContentLength !== asset.sizeBytes ||
      head.ContentType !== asset.contentType
    ) {
      asset.status = 'REJECTED';
      await asset.save();
      throw new BadRequestException(
        'Uploaded file does not match declared size/type',
      );
    }
    if (!head.VersionId || head.VersionId === 'null')
      throw new ServiceUnavailableException(
        'S3 bucket versioning must be enabled',
      );
    asset.versionId = head.VersionId;
    asset.status = 'READY';
    await asset.save();
    return this.toAttachment(asset);
  }

  async resolveAttachments(
    userId: string,
    conversationId: string,
    inputs: ChatAttachment[] = [],
  ): Promise<ChatAttachment[]> {
    if (!Array.isArray(inputs) || inputs.length > 5)
      throw new BadRequestException('Maximum 5 attachments per message');
    if (!inputs.length) return [];
    const ids = [...new Set(inputs.map((input) => input?.storageId))];
    if (
      ids.length !== inputs.length ||
      ids.some((id) => typeof id !== 'string' || !id.startsWith('chat_'))
    )
      throw new BadRequestException('Invalid chat attachment');
    const found = await this.assets
      .find({
        _id: { $in: ids },
        ownerId: userId,
        conversationId,
        status: 'READY',
      })
      .lean()
      .exec();
    const byId = new Map(found.map((asset) => [asset._id, asset]));
    return ids.map((id) => {
      const asset = byId.get(id);
      if (!asset?.versionId)
        throw new BadRequestException(
          'Chat attachment is not ready or not owned by sender',
        );
      return this.toAttachment(asset);
    });
  }

  async getViewUrl(userId: string, conversationId: string, storageId: string) {
    const conversation = await this.conversations.getParticipantOrThrow(
      conversationId,
      userId,
    );
    const asset = await this.assets
      .findOne({ _id: storageId, conversationId, status: 'READY' })
      .lean()
      .exec();
    if (!asset?.versionId)
      throw new NotFoundException('Chat attachment not found');
    if (
      asset.ownerId !== userId &&
      !(await this.messages.exists({
        conversationId: conversation._id,
        'attachments.storageId': storageId,
        hiddenFor: { $ne: userId },
        recalledAt: { $exists: false },
      }))
    ) {
      throw new NotFoundException('Chat attachment not found');
    }
    const url = await this.sign(
      new GetObjectCommand({
        Bucket: asset.bucketName,
        Key: asset.objectKey,
        VersionId: asset.versionId,
        ResponseContentDisposition:
          asset.contentType.startsWith('image/') ||
          asset.contentType === 'application/pdf'
            ? 'inline'
            : 'attachment',
      }),
      300,
    );
    return { url, expiresAt: new Date(Date.now() + 300_000) };
  }

  private async sign(
    command: PutObjectCommand | GetObjectCommand,
    expiresIn: number,
  ) {
    try {
      return await getSignedUrl(this.s3, command, { expiresIn });
    } catch {
      throw new ServiceUnavailableException('Chat file storage is unavailable');
    }
  }

  private toAttachment(asset: ChatAsset | ChatAssetDocument): ChatAttachment {
    return {
      storageId: asset._id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
    };
  }
}
