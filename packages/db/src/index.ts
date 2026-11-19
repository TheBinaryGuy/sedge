export { Approvals, type ApprovalRequest } from './approvals';
export { Database, type DatabaseClient } from './database';
export { Inbox, type NewEvent, type Outcome } from './inbox';
export { Kv } from './kv';
export { Outbox, type NewOutboxMessage } from './outbox';
export { Timers, type NewTimer } from './timers';
export * from './schema';

import { Layer } from 'effect';
import { Approvals } from './approvals';
import { Database } from './database';
import { Inbox } from './inbox';
import { Kv } from './kv';
import { Outbox } from './outbox';
import { Timers } from './timers';

/** Every store, over one SQLite file. */
export const StoresLive = (filename: string) =>
    Layer.mergeAll(Inbox.layer, Timers.layer, Outbox.layer, Approvals.layer, Kv.layer).pipe(
        Layer.provideMerge(Database.layer(filename)),
    );
