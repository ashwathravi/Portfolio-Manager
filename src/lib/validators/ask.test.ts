import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ASK_QUESTION_MAX, askQuestionSchema } from './ask';

const issue = (value: unknown) => {
    const result = askQuestionSchema.safeParse(value);
    return result.success ? null : result.error.issues[0].message;
};

describe('askQuestionSchema', () => {
    test('accepts a question, with its spacing tidied', () => {
        assert.deepEqual(askQuestionSchema.parse({ question: '  Am I   overexposed\n to AI? ' }), { question: 'Am I overexposed to AI?' });
        assert.equal(issue({ question: 'x'.repeat(ASK_QUESTION_MAX) }), null);
    });

    test('refuses an empty or too long question', () => {
        assert.equal(issue({ question: '   ' }), 'Ask a question');
        assert.equal(issue({ question: 'x'.repeat(ASK_QUESTION_MAX + 1) }), 'A question can be at most 500 characters');
    });

    test('refuses anything but a question: other types, control characters, extra fields', () => {
        assert.equal(issue({ question: 42 }), 'question must be text');
        assert.equal(issue({}), 'question must be text');
        assert.equal(issue({ question: 'what\u0000now' }), 'question must be printable text');
        assert.notEqual(issue({ question: 'Hi', history: [] }), null);
    });
});
