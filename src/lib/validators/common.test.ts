import { test, describe } from 'node:test';
import assert from 'node:assert';
import { safeText } from './common.ts';

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
});
