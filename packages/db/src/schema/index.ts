import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = integer('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

/**
 * The event inbox. Every source (the CLI, timers, Telegram, approval answers) appends a row here
 * instead of calling the agent, and one worker drains it. A crash loses nothing: unfinished rows go
 * back to `pending` on start.
 *
 * `thread` is the conversation an event belongs to (`telegram:<chat>`, `cli:<cwd>`). Events for one
 * thread resume that thread's session and are batched into a single run. `externalId` is the
 * source's own id (a Telegram update id), unique per source, so a redelivered event is dropped.
 */
export const inbox = sqliteTable(
    'inbox',
    {
        id: text('id').primaryKey(),
        source: text('source').notNull(),
        externalId: text('external_id'),
        thread: text('thread').notNull(),
        prompt: text('prompt').notNull(),
        cwd: text('cwd').notNull(),
        status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
            .notNull()
            .default('pending'),
        result: text('result'),
        error: text('error'),
        createdAt,
        startedAt: integer('started_at', { mode: 'number' }),
        finishedAt: integer('finished_at', { mode: 'number' }),
        /** Not handed to the agent before this time, so events of a batching signal go together. */
        holdUntil: integer('hold_until', { mode: 'number' }),
    },
    (table) => [
        index('inbox_status_created_idx').on(table.status, table.createdAt),
        uniqueIndex('inbox_source_external_idx').on(table.source, table.externalId),
    ],
);

/**
 * Timers wake the agent without anyone asking. A `followup` is a one-off deadline the agent sets
 * for itself and is `done` once it fires; a `schedule` recurs on its `cron` and only moves its
 * `nextRunAt` forward. Firing a timer appends an event to the inbox for its thread.
 */
export const timers = sqliteTable(
    'timers',
    {
        id: text('id').primaryKey(),
        kind: text('kind', { enum: ['followup', 'schedule'] }).notNull(),
        thread: text('thread').notNull(),
        name: text('name'),
        cron: text('cron'),
        prompt: text('prompt').notNull(),
        cwd: text('cwd').notNull(),
        status: text('status', { enum: ['active', 'done', 'cancelled'] })
            .notNull()
            .default('active'),
        nextRunAt: integer('next_run_at', { mode: 'number' }).notNull(),
        lastRunAt: integer('last_run_at', { mode: 'number' }),
        createdAt,
    },
    (table) => [index('timers_due_idx').on(table.status, table.nextRunAt)],
);

/**
 * What the agent decided to tell the user, waiting for the dispatcher. Delivery is retried with
 * backoff, and the agent's recent messages per thread are what it reads back to avoid repeating
 * itself. `kind: 'approval'` rows carry an approval id and are sent with approve/deny buttons.
 */
/** What a message carries beside its text. */
export interface OutboxExtra {
    readonly choices?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    readonly files?: ReadonlyArray<{ readonly path: string; readonly caption?: string }>;
}

export const outbox = sqliteTable(
    'outbox',
    {
        id: text('id').primaryKey(),
        thread: text('thread').notNull(),
        kind: text('kind', { enum: ['message', 'approval'] })
            .notNull()
            .default('message'),
        text: text('text').notNull(),
        approvalId: text('approval_id'),
        /** Buttons and files to send along: { choices?, files? }. */
        extra: text('extra', { mode: 'json' }).$type<OutboxExtra>(),
        status: text('status', { enum: ['pending', 'sent', 'failed'] })
            .notNull()
            .default('pending'),
        attempts: integer('attempts').notNull().default(0),
        nextAttemptAt: integer('next_attempt_at', { mode: 'number' }).notNull(),
        error: text('error'),
        createdAt,
        sentAt: integer('sent_at', { mode: 'number' }),
    },
    (table) => [
        index('outbox_due_idx').on(table.status, table.nextAttemptAt),
        index('outbox_thread_idx').on(table.thread, table.createdAt),
    ],
);

/**
 * Deferred tool calls. A call that needs the user's say-so is blocked and recorded here; the
 * answer comes back through the inbox, and an approval lets that exact call (same tool, same
 * input) through once.
 */
export const approvals = sqliteTable(
    'approvals',
    {
        id: text('id').primaryKey(),
        thread: text('thread').notNull(),
        toolName: text('tool_name').notNull(),
        inputHash: text('input_hash').notNull(),
        summary: text('summary').notNull(),
        status: text('status', { enum: ['pending', 'approved', 'denied', 'used'] })
            .notNull()
            .default('pending'),
        createdAt,
        decidedAt: integer('decided_at', { mode: 'number' }),
    },
    (table) => [index('approvals_lookup_idx').on(table.thread, table.inputHash, table.status)],
);

/** Small bits of daemon state that must survive restarts, such as Telegram's update offset. */
export const kv = sqliteTable('kv', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

export type InboxItem = typeof inbox.$inferSelect;
export type Timer = typeof timers.$inferSelect;
export type OutboxMessage = typeof outbox.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
