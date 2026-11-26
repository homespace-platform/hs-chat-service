import {
  ForbiddenException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import type { ChatCall, ChatCallKey } from '../domain/chat-call';
import {
  CallHistory,
  type CallHistoryDocument,
} from '../infrastructure/persistence/schemas/call-history.schema';
import { ChatMessageBroadcaster } from './chat-message-broadcaster';
import { ChatMessageService } from './chat-message.service';

const RING_MS = 45_000;
const RECOVERY_INTERVAL_MS = 1000;

@Injectable()
export class ChatCallHistoryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ChatCallHistoryService.name);
  private readonly publications = new Map<string, Promise<void>>();
  private recoveryTimer?: NodeJS.Timeout;
  private recovering = false;

  constructor(
    @InjectModel(CallHistory.name) private readonly calls: Model<CallHistory>,
    private readonly messages: ChatMessageService,
    private readonly broadcaster: ChatMessageBroadcaster,
  ) {}

  onApplicationBootstrap() {
    void this.recover();
    this.recoveryTimer = setInterval(
      () => void this.recover(),
      RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.recoveryTimer);
  }

  async invite(
    key: ChatCallKey,
    callerId: string,
    calleeId: string,
    mode: ChatCall['mode'],
    tracked: boolean,
  ) {
    const _id = this.id(key);
    if (!tracked) {
      return { tracked: false, relay: !(await this.calls.exists({ _id })) };
    }
    const deadlineAt = new Date(Date.now() + RING_MS);
    const result = await this.calls
      .findOneAndUpdate(
        { _id },
        {
          $setOnInsert: {
            conversationId: key.conversationId,
            callId: key.callId,
            messageId: new Types.ObjectId(),
            callerId,
            calleeId,
            mode,
            deadlineAt,
            pendingAt: deadlineAt,
          },
        },
        { upsert: true, includeResultMetadata: true, returnDocument: 'after' },
      )
      .exec();
    if (result.value?.callerId !== callerId || result.value.mode !== mode) {
      throw new ForbiddenException('Call invite does not match the original');
    }
    return {
      tracked: true,
      relay: result.lastErrorObject?.updatedExisting === false,
    };
  }

  async accept(key: ChatCallKey, userId: string): Promise<void> {
    const _id = this.id(key);
    const now = new Date();
    const accepted = await this.calls
      .updateOne(
        {
          _id,
          calleeId: userId,
          acceptedAt: { $exists: false },
          status: { $exists: false },
          deadlineAt: { $gt: now },
        },
        { $set: { acceptedAt: now }, $unset: { pendingAt: 1 } },
      )
      .exec();
    if (accepted.matchedCount) return;

    const call = await this.calls.findById(_id).exec();
    if (!call) return;
    if (call.calleeId !== userId) {
      throw new ForbiddenException('Only the call recipient can accept');
    }
    if (!call.acceptedAt && !call.status) await this.finish(call);
  }

  async end(key: ChatCallKey, userId: string, reason?: 'declined' | 'failed') {
    const call = await this.calls.findById(this.id(key)).exec();
    if (!call) return false;
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new ForbiddenException('User is not a call participant');
    }
    await this.finish(call, userId, reason);
    return true;
  }

  private async finish(
    call: CallHistoryDocument,
    userId?: string,
    reason?: 'declined' | 'failed',
  ): Promise<void> {
    if (call.status) {
      if (call.pendingAt) await this.publish(call._id);
      return;
    }
    const now = new Date();
    const missed = !call.acceptedAt && call.deadlineAt <= now;
    if (!missed && !userId) return;
    if (
      !missed &&
      reason === 'declined' &&
      (call.acceptedAt || userId !== call.calleeId)
    ) {
      return;
    }

    let status: ChatCall['status'];
    if (missed) status = 'missed';
    else if (reason === 'failed') status = 'failed';
    else if (call.acceptedAt) status = 'ended';
    else status = userId === call.callerId ? 'cancelled' : 'declined';

    const finishedAt = missed ? call.deadlineAt : now;
    const updated = await this.calls
      .updateOne(
        {
          _id: call._id,
          status: { $exists: false },
          acceptedAt: call.acceptedAt ?? { $exists: false },
        },
        { $set: { status, finishedAt, pendingAt: now } },
      )
      .exec();
    if (updated.matchedCount) {
      await this.publish(call._id);
    } else {
      const current = await this.calls.findById(call._id).exec();
      if (current) await this.finish(current, userId, reason);
    }
  }

  private publish(id: string) {
    const existing = this.publications.get(id);
    if (existing) return existing;
    const publishing = this.publishPending(id).finally(() =>
      this.publications.delete(id),
    );
    this.publications.set(id, publishing);
    return publishing;
  }

  private async publishPending(id: string) {
    const call = await this.calls.findById(id).exec();
    if (!call?.pendingAt || !call.status || !call.finishedAt) return;
    await this.messages.publishCall(
      call.messageId,
      call.conversationId,
      call.calleeId,
      {
        callId: call.callId,
        callerId: call.callerId,
        mode: call.mode,
        status: call.status,
      },
      call.finishedAt,
    );
    this.broadcaster.broadcastCallEnded(call.callerId, call.calleeId, {
      conversationId: call.conversationId.toString(),
      callId: call.callId,
    });
    await this.calls
      .updateOne({ _id: id }, { $unset: { pendingAt: 1 } })
      .exec();
  }

  private async recover() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const pending = await this.calls
        .find({ pendingAt: { $lte: new Date() } })
        .exec();
      for (const call of pending) {
        await this.finish(call).catch((error) =>
          this.logger.error('Call history recovery failed', error),
        );
      }
    } catch (error) {
      this.logger.error('Unable to load pending call history', error);
    } finally {
      this.recovering = false;
    }
  }

  private id(key: ChatCallKey) {
    return `${key.conversationId.toLowerCase()}:${key.callId.toLowerCase()}`;
  }
}
