/** How hard a model thinks, as pi names the levels. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const isLevel = (value: string): value is ThinkingLevel =>
    (THINKING_LEVELS as ReadonlyArray<string>).includes(value);

/**
 * A model setting split into the model and its thinking level: `provider/model:medium` → the
 * model and `medium`, as pi's `--model` reads it. A suffix that isn't a level stays part of the
 * id (some ids have a colon in them).
 */
export const splitModel = (setting: string): { id: string; thinking?: ThinkingLevel } => {
    const at = setting.lastIndexOf(':');
    const suffix = at > 0 ? setting.slice(at + 1).toLowerCase() : '';
    return isLevel(suffix) ? { id: setting.slice(0, at), thinking: suffix } : { id: setting };
};
