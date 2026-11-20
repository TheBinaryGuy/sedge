import { describe, expect, it } from 'vitest';
import { splitModel } from './model';

describe('a model setting', () => {
    it('takes a thinking level after a colon, as pi’s --model does', () => {
        expect(splitModel('anthropic/claude-opus-5-5:medium')).toEqual({
            id: 'anthropic/claude-opus-5-5',
            thinking: 'medium',
        });
        expect(splitModel('anthropic/claude-opus-5-5')).toEqual({
            id: 'anthropic/claude-opus-5-5',
        });
    });

    it('keeps a colon that is part of the id', () => {
        expect(splitModel('amazon-bedrock/anthropic.claude-opus-5-5-v1:0')).toEqual({
            id: 'amazon-bedrock/anthropic.claude-opus-5-5-v1:0',
        });
        expect(splitModel('amazon-bedrock/anthropic.claude-opus-5-5-v1:0:high')).toEqual({
            id: 'amazon-bedrock/anthropic.claude-opus-5-5-v1:0',
            thinking: 'high',
        });
    });
});
