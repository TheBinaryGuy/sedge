/**
 * Conditions on a signal's events, written the way you'd say them:
 * `temperature > 30 and room = kitchen`, `payload.status != ok or payload.retries >= 3`.
 *
 * A clause is a field, an operator and a value. The field is a path into the event's details
 * (`payload.moisture`, `sensors.0.value`), `text` for the event's text, or `state.<name>` for a
 * named value sedge keeps (`state.mode = away`). Operators: `=`, `!=`,
 * `>`, `>=`, `<`, `<=` and `contains`. A value is a number, a word, or text in quotes. `and` binds
 * tighter than `or`. A field the event doesn't have fails its clause.
 */

type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains';
interface Clause {
    readonly path: ReadonlyArray<string>;
    readonly op: Op;
    readonly value: string | number;
}
/** Any of these groups, each true when all its clauses are. */
export type Condition = ReadonlyArray<ReadonlyArray<Clause>>;

const OPS: ReadonlyArray<Op> = ['>=', '<=', '!=', '=', '>', '<'];
const TOKEN = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(>=|<=|!=|==|=|>|<)|([^\s"'<>=!]+))/y;

type Token = { readonly kind: 'quoted' | 'op' | 'word'; readonly text: string };

const tokenize = (source: string): Array<Token> => {
    const tokens: Array<Token> = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < source.length) {
        if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) break;
        const at = TOKEN.lastIndex;
        const match = TOKEN.exec(source);
        if (!match) throw new Error(`can't read "${source.slice(at).trim()}"`);
        const [, double, single, op, word] = match;
        if (double !== undefined || single !== undefined) {
            tokens.push({ kind: 'quoted', text: (double ?? single)!.replace(/\\(.)/g, '$1') });
        } else if (op !== undefined) tokens.push({ kind: 'op', text: op === '==' ? '=' : op });
        else tokens.push({ kind: 'word', text: word! });
    }
    return tokens;
};

/** Reads a condition, or throws saying what's wrong with it. */
export const parseCondition = (source: string): Condition => {
    const tokens = tokenize(source);
    const groups: Array<Array<Clause>> = [[]];
    let i = 0;
    const next = () => tokens[i++];
    while (i < tokens.length) {
        const field = next()!;
        if (field.kind !== 'word') throw new Error(`expected a field, found "${field.text}"`);
        const operator = next();
        const op =
            operator?.kind === 'op'
                ? (operator.text as Op)
                : operator?.kind === 'word' && operator.text.toLowerCase() === 'contains'
                  ? 'contains'
                  : undefined;
        if (!op || (operator!.kind === 'op' && !OPS.includes(op))) {
            throw new Error(
                `expected =, !=, >, >=, <, <= or contains after "${field.text}"${operator ? `, found "${operator.text}"` : ''}`,
            );
        }
        const value = next();
        if (!value || value.kind === 'op') {
            throw new Error(`expected a value after "${field.text} ${op}"`);
        }
        const number = Number(value.text);
        groups[groups.length - 1]!.push({
            path: field.text.split('.'),
            op,
            value:
                value.kind === 'word' && value.text !== '' && !Number.isNaN(number)
                    ? number
                    : value.text,
        });
        if (i === tokens.length) break;
        const joiner = next()!;
        const word = joiner.kind === 'word' ? joiner.text.toLowerCase() : '';
        if (word === 'or') groups.push([]);
        else if (word !== 'and') throw new Error(`expected "and" or "or", found "${joiner.text}"`);
        if (i === tokens.length) throw new Error(`nothing after "${joiner.text}"`);
    }
    if (groups[0]!.length === 0) throw new Error('it is empty');
    return groups;
};

const lookup = (subject: unknown, path: ReadonlyArray<string>): unknown => {
    let current = subject;
    for (const part of path) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
};

const asNumber = (value: unknown) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
        return Number(value);
    }
    return undefined;
};

/** A value as text to compare: objects as JSON, never "[object Object]". */
const textOf = (value: unknown) =>
    typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);

const same = (actual: unknown, expected: string | number) => {
    const n = asNumber(actual);
    if (typeof expected === 'number' && n !== undefined) return n === expected;
    if (actual === null || typeof actual === 'object') return false;
    return textOf(actual).toLowerCase() === String(expected).toLowerCase();
};

const holds = (clause: Clause, subject: unknown): boolean => {
    const actual = lookup(subject, clause.path);
    if (actual === undefined) return false;
    const { op, value } = clause;
    if (op === '=') return same(actual, value);
    if (op === '!=') return !same(actual, value);
    if (op === 'contains') {
        const needle = String(value).toLowerCase();
        if (Array.isArray(actual)) return actual.some((item) => same(item, value));
        return textOf(actual).toLowerCase().includes(needle);
    }
    const a = asNumber(actual);
    const b = asNumber(value);
    if (a === undefined || b === undefined) return false;
    return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
};

/**
 * Whether an event meets a condition. Fields are looked up in its details, and `text` is its text
 * unless the details have a `text` of their own.
 */
export const meets = (
    condition: Condition,
    event: { text: string; details?: unknown },
    state: Readonly<Record<string, unknown>> = {},
) => {
    const own =
        event.details !== null && typeof event.details === 'object' && !Array.isArray(event.details)
            ? { text: event.text, ...(event.details as Record<string, unknown>) }
            : { text: event.text, details: event.details };
    // `state.<name>` reads a named value, as sedge keeps them.
    const subject = { ...own, state };
    return condition.some((group) => group.every((clause) => holds(clause, subject)));
};
