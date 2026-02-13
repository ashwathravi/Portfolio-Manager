import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tagSchema } from './settings.ts';

describe('tagSchema', () => {
    test('should validate a valid tag', () => {
        const validTag = {
            name: 'Work',
            color: '#ff0000'
        };
        const result = tagSchema.safeParse(validTag);
        assert.strictEqual(result.success, true);
    });

    test('should fail if name is empty', () => {
        const invalidTag = {
            name: '',
            color: '#ff0000'
        };
        const result = tagSchema.safeParse(invalidTag);
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Tag name is required');
        }
    });

    test('should fail if name is only whitespace', () => {
        const invalidTag = {
            name: '   ',
            color: '#ff0000'
        };
        const result = tagSchema.safeParse(invalidTag);
        assert.strictEqual(result.success, false, 'Whitespace-only name should fail');
    });

    test('should fail if name is too long', () => {
        const invalidTag = {
            name: 'a'.repeat(31),
            color: '#ff0000'
        };
        const result = tagSchema.safeParse(invalidTag);
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Tag name is too long');
        }
    });

    test('should fail if color is not a valid hex color', () => {
        const invalidColors = [
            'ff0000',    // missing #
            '#gggggg',    // invalid hex chars
            '#ff00000',   // too many digits
            '#ff000'      // too few digits
        ];

        for (const color of invalidColors) {
            const result = tagSchema.safeParse({ name: 'Test', color });
            assert.strictEqual(result.success, false, `Color ${color} should be invalid`);
            if (!result.success) {
                assert.strictEqual(result.error.issues[0].message, 'Must be a valid hex color');
            }
        }
    });

    test('should allow 3 or 6 digit hex colors', () => {
        const validColors = ['#f00', '#ff0000', '#ABC', '#AABBCC'];
        for (const color of validColors) {
            const result = tagSchema.safeParse({ name: 'Test', color });
            assert.strictEqual(result.success, true, `Color ${color} should be valid`);
        }
    });

    test('should accept uppercase hex colors', () => {
        const validTag = {
            name: 'Work',
            color: '#FF0000'
        };
        const result = tagSchema.safeParse(validTag);
        assert.strictEqual(result.success, true);
    });
});
