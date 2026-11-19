import { SqliteClient } from '@effect/sql-sqlite-bun';
import * as SQLiteBunDrizzle from 'drizzle-orm/effect-sqlite-bun';
import { migrate } from 'drizzle-orm/sqlite-core/effect';
import { Context, Effect, Layer } from 'effect';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { migrations } from './migrations.gen';

const makeDatabase = SQLiteBunDrizzle.makeWithDefaults();

export type DatabaseClient = Effect.Success<typeof makeDatabase>;

/** Drizzle over Effect's Bun SQLite client. Migrations run before the layer is ready. */
export class Database extends Context.Service<Database, DatabaseClient>()('sedge/db/Database') {
    static readonly layer = (filename: string) =>
        Layer.effect(
            Database,
            Effect.gen(function* () {
                const db = yield* makeDatabase;
                yield* migrate(migrations, db._.session, {
                    migrationsTable: '__drizzle_migrations',
                });
                return db;
            }).pipe(Effect.orDie),
        ).pipe(
            Layer.provide(SqliteClient.layer({ filename })),
            Layer.provide(
                Layer.effectDiscard(
                    filename === ':memory:'
                        ? Effect.void
                        : Effect.promise(() => mkdir(dirname(filename), { recursive: true })),
                ),
            ),
        );
}
