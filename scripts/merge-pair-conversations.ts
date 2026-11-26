/**
 * Merges legacy per-listing conversations into ONE conversation per pair of users.
 *
 * Dry-run (default):  npx ts-node scripts/merge-pair-conversations.ts
 * Apply:              npx ts-node scripts/merge-pair-conversations.ts --apply
 * Mongo URI comes from MONGODB_URI (same variable as the service), e.g.
 *   node --env-file=.env -r ts-node/register scripts/merge-pair-conversations.ts [--apply]
 *
 * Back up the database first. Safe to re-run. Messages are moved BEFORE a conversation is deleted, and a
 * conversation that still owns messages is never deleted.
 */
import mongoose from 'mongoose';
import type { Collection, Document } from 'mongodb';
import { DIRECT_CONVERSATION_LISTING_ID as DIRECT } from '../src/modules/chat/application/conversation-key';
import {
  planPairMerge,
  type ConversationRow,
  type PairEntry,
} from './merge-pair-conversations.logic';

const OLD_INDEX = 'participantKey_1_listingId_1';

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const conversations: Collection<Document> = db.collection('conversations');
  const messages: Collection<Document> = db.collection('messages');
  // Other collections that reference conversationId: chat_assets only (string id; its S3 objectKey is
  // stored per asset, so the old key path stays valid). Calls (Agora tokens) are stateless.
  const assets: Collection<Document> = db.collection('chat_assets');

  console.log(apply ? 'MODE: APPLY' : 'MODE: DRY-RUN (pass --apply to write)');

  const duplicateKeys: string[] = (
    await conversations
      .aggregate([
        { $group: { _id: '$participantKey', n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray()
  ).map((row) => row._id);
  const legacyKeys: string[] = await conversations.distinct('participantKey', {
    $or: [{ listing: { $exists: true } }, { listingId: { $ne: DIRECT } }],
  });
  const keys = [...new Set([...duplicateKeys, ...legacyKeys])].sort();
  console.log(
    `${duplicateKeys.length} pair(s) with duplicates, ${keys.length} pair(s) to process`,
  );

  for (const key of keys) {
    const docs = await conversations.find({ participantKey: key }).toArray();
    const entries: PairEntry[] = [];
    for (const doc of docs) {
      const [earliest] = await messages
        .find({ conversationId: doc._id })
        .sort({ createdAt: 1 })
        .limit(1)
        .toArray();
      const [newest] = await messages
        .find({ conversationId: doc._id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      entries.push({
        conversation: { ...doc, id: String(doc._id) } as unknown as ConversationRow,
        messageCount: await messages.countDocuments({ conversationId: doc._id }),
        earliest: earliest && {
          id: String(earliest._id),
          hasListing: !!earliest.listing,
          recalled: !!earliest.recalledAt,
        },
        newest: newest && {
          content: newest.content,
          createdAt: newest.createdAt,
          senderId: newest.senderId,
        },
      });
    }

    const plan = planPairMerge(entries, DIRECT);
    console.log(
      `[${key}] survivor=${plan.survivorId} merge=[${plan.mergedIds.join(', ')}] ` +
        `messages=${JSON.stringify(plan.messageCounts)} listingCards=${plan.listingSeeds.length}`,
    );
    if (!apply) continue;

    const id = (value: string) => docs.find((d) => String(d._id) === value)!._id;
    // 1. keep the old listing card in the thread, at its original time
    for (const seed of plan.listingSeeds) {
      await messages.updateOne(
        { _id: new mongoose.Types.ObjectId(seed.messageId), listing: { $exists: false } },
        { $set: { listing: seed.listing } },
      );
    }
    // 2. move messages and assets BEFORE anything is deleted
    for (const mergedId of plan.mergedIds) {
      await messages.updateMany(
        { conversationId: id(mergedId) },
        { $set: { conversationId: id(plan.survivorId) } },
      );
      await assets.updateMany(
        { conversationId: mergedId },
        { $set: { conversationId: plan.survivorId } },
      );
    }
    // 3. survivor fields (a lone conversation only drops its legacy listing)
    const { listingId, ...merged } = plan.survivorSet;
    const updatedAt = new Date(
      Math.max(
        ...entries.map((e) => (e.conversation.updatedAt ?? new Date(0)).getTime()),
        plan.survivorSet.lastMessageAt?.getTime() ?? 0,
      ),
    );
    await conversations.updateOne(
      { _id: id(plan.survivorId) },
      {
        $set: plan.mergedIds.length ? { ...merged, listingId, updatedAt } : { listingId },
        $unset: { listing: 1 },
      },
    );
    // 4. delete emptied conversations, but never one that still owns messages
    for (const mergedId of plan.mergedIds) {
      if (await messages.countDocuments({ conversationId: id(mergedId) })) {
        console.error(`  SKIP delete ${mergedId}: still has messages`);
        continue;
      }
      await conversations.deleteOne({ _id: id(mergedId) });
    }
  }

  if (apply) {
    const left = await conversations
      .aggregate([
        { $group: { _id: '$participantKey', n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();
    if (left.length) {
      console.error(`${left.length} duplicate pair(s) remain; indexes NOT changed`);
      process.exitCode = 1;
    } else {
      if (await conversations.indexExists(OLD_INDEX)) {
        await conversations.dropIndex(OLD_INDEX);
      }
      await conversations.createIndex({ participantKey: 1 }, { unique: true });
      console.log('Index: dropped old compound, ensured unique { participantKey: 1 }');
    }
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
