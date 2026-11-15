/**
 * The user's Ask conversation, kept on the server (launch item i56): every
 * query scoped to one user's ID, which the API route takes from the session.
 *
 * - The conversation is the last ASK_HISTORY_LIMIT messages not cleared.
 * - The daily limit is ASK_DAILY_LIMIT questions in any 24 hours. Clearing
 *   the conversation marks its rows `cleared` rather than deleting them, so
 *   it doesn't reset the count.
 * - A question takes its place in the limit before it's answered
 *   (`reserveAskQuestion`), so questions asked at once can't each be
 *   answered, by Claude at a cost (launch item i59), past the limit. Its
 *   answer is kept after (`saveAskAnswer`); a question that couldn't be
 *   answered gives its place back (`releaseAskQuestion`).
 * - Rows older than a day that are cleared, or past the last
 *   ASK_HISTORY_LIMIT, are deleted: the user's own when they ask or clear,
 *   and everyone's by the daily job "ask-history", so a conversation
 *   cleared and never followed by another question goes too.
 */

import { and, count, desc, eq, gte, lt, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { askMessages } from "@/db/schema";

import type { AskCitation, AskMessage, AskToolRun } from "../types";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Messages kept in the conversation: 25 questions and their answers. */
export const ASK_HISTORY_LIMIT = 50;
/** Questions a user can ask in any 24 hours. */
export const ASK_DAILY_LIMIT = 30;
export const ASK_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export class AskDailyLimitError extends Error {
    constructor() {
        super(`You've asked ${ASK_DAILY_LIMIT} questions in the last 24 hours. Try again later.`);
        this.name = "AskDailyLimitError";
    }
}

/** The conversation, newest first (the caller puts it in order). */
export function buildAskHistoryQuery(userId: string, database: Executor = db) {
    return database
        .select()
        .from(askMessages)
        .where(and(eq(askMessages.userId, userId), eq(askMessages.cleared, false)))
        .orderBy(desc(askMessages.createdAt), desc(askMessages.id))
        .limit(ASK_HISTORY_LIMIT);
}

/** Questions asked since `since`, cleared or not. */
export function buildQuestionsSinceQuery(userId: string, since: Date, database: Executor = db) {
    return database
        .select({ questions: count() })
        .from(askMessages)
        .where(and(eq(askMessages.userId, userId), eq(askMessages.role, "user"), gte(askMessages.createdAt, since)));
}

/** One question at a time per user, so two at once can't both pass the limit. */
export function buildLockAskQuery(userId: string, database: Pick<Database, "execute"> = db) {
    return database.execute(sql`select pg_advisory_xact_lock(hashtext(${`atlas:ask:${userId}`}))`);
}

export function buildInsertMessagesQuery(userId: string, messages: readonly AskMessage[], database: Executor = db) {
    return database.insert(askMessages).values(messages.map((message) => ({
        userId,
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations ?? [],
        toolRuns: message.toolRuns ?? [],
        createdAt: new Date(message.ts),
    })));
}

/** Whether a question is still in the conversation: missing if given back, `cleared` if cleared. */
export function buildAskQuestionQuery(userId: string, questionId: string, database: Executor = db) {
    return database
        .select({ cleared: askMessages.cleared })
        .from(askMessages)
        .where(and(eq(askMessages.userId, userId), eq(askMessages.id, questionId), eq(askMessages.role, "user")));
}

/** A question the user asked that couldn't be answered. */
export function buildDeleteQuestionQuery(userId: string, questionId: string, database: Executor = db) {
    return database
        .delete(askMessages)
        .where(and(eq(askMessages.userId, userId), eq(askMessages.id, questionId), eq(askMessages.role, "user")));
}

export function buildClearAskHistoryQuery(userId: string, database: Executor = db) {
    return database
        .update(askMessages)
        .set({ cleared: true })
        .where(and(eq(askMessages.userId, userId), eq(askMessages.cleared, false)));
}

/** Rows older than `before` that are cleared or no longer in the conversation. */
export function buildPruneAskHistoryQuery(userId: string, before: Date, database: Executor = db) {
    const kept = database
        .select({ id: askMessages.id })
        .from(askMessages)
        .where(and(eq(askMessages.userId, userId), eq(askMessages.cleared, false)))
        .orderBy(desc(askMessages.createdAt), desc(askMessages.id))
        .limit(ASK_HISTORY_LIMIT);
    return database
        .delete(askMessages)
        .where(and(
            eq(askMessages.userId, userId),
            lt(askMessages.createdAt, before),
            or(eq(askMessages.cleared, true), notInArray(askMessages.id, kept)),
        ));
}

/**
 * Every user's rows older than `before` that are cleared, or past their
 * last ASK_HISTORY_LIMIT messages not cleared.
 */
export function buildPruneAllAskHistoryQuery(before: Date, database: Pick<Database, "execute"> = db) {
    return database.execute(sql`
        delete from ${askMessages}
        where ${askMessages.createdAt} < ${before.toISOString()}::timestamp
          and (
            ${askMessages.cleared}
            or (${askMessages.userId}, ${askMessages.id}) not in (
              select user_id, id from (
                select user_id, id, row_number() over (partition by user_id order by created_at desc, id desc) as place
                from ${askMessages}
                where not cleared
              ) as kept
              where place <= ${ASK_HISTORY_LIMIT}
            )
          )
    `);
}

/** Daily job "ask-history": deletes what no conversation keeps any more. */
export async function pruneAskHistory({
    now = new Date(),
    database = db,
}: { now?: Date; database?: Database } = {}): Promise<{ deleted: number }> {
    const result = await buildPruneAllAskHistoryQuery(new Date(now.getTime() - ASK_LIMIT_WINDOW_MS), database);
    return { deleted: result.count };
}

type AskMessageRow = typeof askMessages.$inferSelect;

function toMessage(row: AskMessageRow): AskMessage {
    return {
        id: row.id,
        role: row.role === "assistant" ? "assistant" : "user",
        content: row.content,
        ts: row.createdAt.getTime(),
        ...(row.role === "assistant"
            ? { citations: row.citations as AskCitation[], toolRuns: row.toolRuns as AskToolRun[] }
            : {}),
    };
}

export interface AskHistory {
    messages: AskMessage[];
    /** Questions asked in the last 24 hours. */
    questionsToday: number;
}

export async function loadAskHistory(userId: string, now: Date = new Date(), database: Database = db): Promise<AskHistory> {
    const [rows, [{ questions }]] = await Promise.all([
        buildAskHistoryQuery(userId, database),
        buildQuestionsSinceQuery(userId, new Date(now.getTime() - ASK_LIMIT_WINDOW_MS), database),
    ]);
    return { messages: rows.reverse().map(toMessage), questionsToday: questions };
}

export async function questionsAsked(userId: string, now: Date = new Date(), database: Executor = db): Promise<number> {
    const [{ questions }] = await buildQuestionsSinceQuery(userId, new Date(now.getTime() - ASK_LIMIT_WINDOW_MS), database);
    return questions;
}

/**
 * Keeps a question before it's answered, if the user is still under the
 * daily limit, under the user's lock: of questions asked at once, only
 * those under the limit get an answer. Returns the questions asked in the
 * last 24 hours, this one included. Throws AskDailyLimitError past it.
 */
export async function reserveAskQuestion(
    userId: string,
    question: AskMessage,
    now: Date = new Date(),
    database: Database = db,
): Promise<number> {
    return database.transaction(async (tx) => {
        await buildLockAskQuery(userId, tx);
        const asked = await questionsAsked(userId, now, tx);
        if (asked >= ASK_DAILY_LIMIT) throw new AskDailyLimitError();
        await buildInsertMessagesQuery(userId, [question], tx);
        return asked + 1;
    });
}

/**
 * Keeps the answer to a question `reserveAskQuestion` kept, unless the
 * conversation was cleared (or the question given back) meanwhile, and
 * prunes what's old.
 */
export async function saveAskAnswer(
    userId: string,
    questionId: string,
    answer: AskMessage,
    now: Date = new Date(),
    database: Database = db,
): Promise<void> {
    await database.transaction(async (tx) => {
        await buildLockAskQuery(userId, tx);
        const [question] = await buildAskQuestionQuery(userId, questionId, tx);
        if (question && !question.cleared) await buildInsertMessagesQuery(userId, [answer], tx);
        await buildPruneAskHistoryQuery(userId, new Date(now.getTime() - ASK_LIMIT_WINDOW_MS), tx);
    });
}

/** Gives back the place of a question that couldn't be answered. */
export async function releaseAskQuestion(userId: string, questionId: string, database: Database = db): Promise<void> {
    await buildDeleteQuestionQuery(userId, questionId, database);
}

/** Hides the conversation now; what's already a day old goes now too, the rest by the daily job. */
export async function clearAskHistory(userId: string, now: Date = new Date(), database: Database = db): Promise<void> {
    await database.transaction(async (tx) => {
        await buildClearAskHistoryQuery(userId, tx);
        await buildPruneAskHistoryQuery(userId, new Date(now.getTime() - ASK_LIMIT_WINDOW_MS), tx);
    });
}
