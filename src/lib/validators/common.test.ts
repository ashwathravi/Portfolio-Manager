import { test, describe } from 'node:test';
import assert from 'node:assert';
import { safeText } from './common';

describe('safeText', () => {
    test('should accept valid text', () => {
        const valid = 'Hello World 123 !@#$%^&*()';
        const result = safeText.safeParse(valid);
        assert.strictEqual(result.success, true);
    });

    test('should reject text with <', () => {
        const invalid = 'Hello < World';
        const result = safeText.safeParse(invalid);
        assert.strictEqual(result.success, false);
    });

    test('should reject text with >', () => {
        const invalid = 'Hello > World';
        const result = safeText.safeParse(invalid);
        assert.strictEqual(result.success, false);
    });

    test('should reject HTML tags', () => {
        const invalid = '<script>alert(1)</script>';
        const result = safeText.safeParse(invalid);
        assert.strictEqual(result.success, false);
    });

    // CSV Injection / Formula Injection prevention
    test('should reject text starting with =', () => {
        const invalid = '=SUM(1,2)';
        const result = safeText.safeParse(invalid);
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.ok(result.error.issues[0].message.includes('Input cannot start with ='));
        }
    });

    // Common characters that might start formulas but are valid text
    test('should accept text starting with + (e.g. phone numbers)', () => {
        const valid = '+1234567890';
        const result = safeText.safeParse(valid);
        assert.strictEqual(result.success, true);
    });

    test('should accept text starting with - (e.g. negative numbers or bullets)', () => {
        const valid = '-5%';
        const result = safeText.safeParse(valid);
        assert.strictEqual(result.success, true);
    });

    test('should accept text starting with @ (e.g. handles)', () => {
        const valid = '@username';
        const result = safeText.safeParse(valid);
        assert.strictEqual(result.success, true);
    });

    test('should accept text with = in the middle', () => {
        const valid = 'E=mc^2';
        const result = safeText.safeParse(valid);
        assert.strictEqual(result.success, true);
    });

    // Postgres can't store a NUL in a text column: the save would be a 500.
    test('should reject text with a NUL character, wherever it is', () => {
        for (const invalid of ['\u0000', 'Sample\u0000note', 'Sample note\u0000']) {
            const result = safeText.safeParse(invalid);
            assert.strictEqual(result.success, false);
            if (!result.success) {
                assert.strictEqual(result.error.issues[0].message, 'Input contains an invalid character (a null character)');
            }
        }
    });

    test('should accept other control characters and line breaks, as before', () => {
        assert.strictEqual(safeText.safeParse('Line one\nLine two\ttabbed\u0001').success, true);
    });
});
