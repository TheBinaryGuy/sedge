import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamps = {
    createdAt: integer('created_at', { mode: 'number' })
        .notNull()
        .default(sql`(unixepoch('subsec') * 1000)`),
};

/**
 * Every piece of work the agent does arrives here first: a prompt typed in the client, a timer
 * that came due, later a webhook or a chat message. One worker drains it in order, so two runs
 * never compete for the same session, and anything written here survives a daemon crash.
 */
export const inbox = sqliteTable(
    'inbox',
    {
        id: text('id').primaryKey(),
        source: text('source', { enum: ['cli', 'timer'] }).notNull(),
        prompt: text('prompt').notNull(),
        cwd: text('cwd').notNull(),
        status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
            .notNull()
            .default('pending'),
        result: text('result'),
        error: text('error'),
        ...timestamps,
        startedAt: integer('started_at', { mode: 'number' }),
        finishedAt: integer('finished_at', { mode: 'number' }),
    },
    (table) => [index('inbox_status_created_idx').on(table.status, table.createdAt)],
);

/** Recurring prompts. `cron` uses the standard five fields, evaluated in the machine's zone. */
export const timers = sqliteTable(
    'timers',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull().unique(),
        cron: text('cron').notNull(),
        prompt: text('prompt').notNull(),
        cwd: text('cwd').notNull(),
        enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
        nextRunAt: integer('next_run_at', { mode: 'number' }).notNull(),
        lastRunAt: integer('last_run_at', { mode: 'number' }),
        ...timestamps,
    },
    (table) => [index('timers_due_idx').on(table.enabled, table.nextRunAt)],
);

export type InboxItem = typeof inbox.$inferSelect;
export type Timer = typeof timers.$inferSelect;
