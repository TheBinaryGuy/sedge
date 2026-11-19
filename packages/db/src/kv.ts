import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { kv } from './schema';

export class Kv extends Context.Service<
    Kv,
    {
        readonly get: (key: string) => Effect.Effect<string | undefined>;
        readonly set: (key: string, value: string) => Effect.Effect<void>;
    }
>()('sedge/db/Kv') {
    static readonly layer = Layer.effect(
        Kv,
        Effect.gen(function* () {
            const db = yield* Database;
            return Kv.of({
                get: (key) =>
                    db
                        .select()
                        .from(kv)
                        .where(eq(kv.key, key))
                        .pipe(
                            Effect.map((rows) => rows[0]?.value),
                            Effect.orDie,
                        ),
                set: (key, value) =>
                    db
                        .insert(kv)
                        .values({ key, value })
                        .onConflictDoUpdate({ target: kv.key, set: { value } })
                        .pipe(Effect.asVoid, Effect.orDie),
            });
        }),
    );
}
