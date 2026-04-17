import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatErrorMessage } from './error-state.tsx';

describe('formatErrorMessage', () => {
    test('returns generic message when error is undefined', () => {
        assert.strictEqual(formatErrorMessage(undefined), 'An unexpected error occurred.');
    });

    test('returns the error message when present', () => {
        assert.strictEqual(
            formatErrorMessage(new Error('Boom')),
            'Boom',
        );
    });

    test('falls back to digest reference when message is blank', () => {
        const err = Object.assign(new Error(''), { digest: 'abc123' });
        assert.strictEqual(formatErrorMessage(err), 'Error reference: abc123');
    });

    test('falls back to digest reference when message is only whitespace', () => {
        const err = Object.assign(new Error('   '), { digest: 'xyz' });
        assert.strictEqual(formatErrorMessage(err), 'Error reference: xyz');
    });

    test('returns generic message when neither message nor digest are present', () => {
        assert.strictEqual(formatErrorMessage(new Error('')), 'An unexpected error occurred.');
    });
});
