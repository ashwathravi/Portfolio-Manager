import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tagSchema, profileSchema, passwordChangeSchema, apiKeySchema, preferencesSchema } from './settings';

// ---------------------------------------------------------------------------
// tagSchema
// ---------------------------------------------------------------------------

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

    test('should fail if tag name contains HTML tags', () => {
        const invalidTag = {
            name: '<script>alert(1)</script>',
            color: '#FF0000'
        };
        const result = tagSchema.safeParse(invalidTag);
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Input contains invalid characters (< or >)');
        }
    });
});

// ---------------------------------------------------------------------------
// profileSchema
// ---------------------------------------------------------------------------

describe('profileSchema', () => {
    const validProfile = {
        fullName: 'John Doe',
        email: 'john@example.com',
        phone: '+1 (555) 123-4567',
    };

    test('should validate a valid profile', () => {
        const result = profileSchema.safeParse(validProfile);
        assert.strictEqual(result.success, true);
    });

    test('should fail if fullName is too short', () => {
        const result = profileSchema.safeParse({ ...validProfile, fullName: 'J' });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Name must be at least 2 characters');
        }
    });

    test('should fail if fullName is too long', () => {
        const result = profileSchema.safeParse({ ...validProfile, fullName: 'a'.repeat(101) });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Name is too long');
        }
    });

    test('should accept fullName at boundary lengths', () => {
        const min = profileSchema.safeParse({ ...validProfile, fullName: 'Jo' });
        assert.strictEqual(min.success, true);
        const max = profileSchema.safeParse({ ...validProfile, fullName: 'a'.repeat(100) });
        assert.strictEqual(max.success, true);
    });

    test('should fail if fullName contains HTML tags', () => {
        const result = profileSchema.safeParse({ ...validProfile, fullName: 'John <script>Doe' });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Input contains invalid characters (< or >)');
        }
    });

    test('should fail if email is invalid', () => {
        const invalidEmails = ['notanemail', 'missing@', '@nodomain.com', 'spaces in@email.com'];
        for (const email of invalidEmails) {
            const result = profileSchema.safeParse({ ...validProfile, email });
            assert.strictEqual(result.success, false, `Email "${email}" should be invalid`);
        }
    });

    test('should accept valid emails', () => {
        const validEmails = ['user@example.com', 'first.last@domain.co', 'a+b@test.org'];
        for (const email of validEmails) {
            const result = profileSchema.safeParse({ ...validProfile, email });
            assert.strictEqual(result.success, true, `Email "${email}" should be valid`);
        }
    });

    test('should fail if phone is too short', () => {
        const result = profileSchema.safeParse({ ...validProfile, phone: '12345' });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Phone number must be at least 10 characters');
        }
    });

    test('should fail if phone is too long', () => {
        const result = profileSchema.safeParse({ ...validProfile, phone: '1'.repeat(21) });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Phone number is too long');
        }
    });

    test('should accept phone at boundary lengths', () => {
        const min = profileSchema.safeParse({ ...validProfile, phone: '1'.repeat(10) });
        assert.strictEqual(min.success, true);
        const max = profileSchema.safeParse({ ...validProfile, phone: '1'.repeat(20) });
        assert.strictEqual(max.success, true);
    });
});

// ---------------------------------------------------------------------------
// passwordChangeSchema
// ---------------------------------------------------------------------------

describe('passwordChangeSchema', () => {
    const validPassword = {
        currentPassword: 'oldpassword123',
        newPassword: 'NewSecure1!pass',
        confirmPassword: 'NewSecure1!pass',
    };

    test('should validate a valid password change', () => {
        const result = passwordChangeSchema.safeParse(validPassword);
        assert.strictEqual(result.success, true);
    });

    test('should fail if currentPassword is empty', () => {
        const result = passwordChangeSchema.safeParse({ ...validPassword, currentPassword: '' });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i => i.path.includes('currentPassword'));
            assert.ok(issue, 'Should have an issue on currentPassword');
            assert.strictEqual(issue!.message, 'Current password is required');
        }
    });

    test('should fail if newPassword is too short', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            newPassword: 'Ab1!short',
            confirmPassword: 'Ab1!short',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i => i.path.includes('newPassword'));
            assert.ok(issue, 'Should have an issue on newPassword');
            assert.strictEqual(issue!.message, 'Password must be at least 12 characters');
        }
    });

    test('should fail if newPassword has no uppercase letter', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            newPassword: 'alllowercase1!xx',
            confirmPassword: 'alllowercase1!xx',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i =>
                i.message === 'Must contain at least one uppercase letter'
            );
            assert.ok(issue, 'Should require an uppercase letter');
        }
    });

    test('should fail if newPassword has no lowercase letter', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            newPassword: 'ALLUPPERCASE1!XX',
            confirmPassword: 'ALLUPPERCASE1!XX',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i =>
                i.message === 'Must contain at least one lowercase letter'
            );
            assert.ok(issue, 'Should require a lowercase letter');
        }
    });

    test('should fail if newPassword has no digit', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            newPassword: 'NoDigitsHere!!xx',
            confirmPassword: 'NoDigitsHere!!xx',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i =>
                i.message === 'Must contain at least one number'
            );
            assert.ok(issue, 'Should require a digit');
        }
    });

    test('should fail if newPassword has no special character', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            newPassword: 'NoSpecialChar1xx',
            confirmPassword: 'NoSpecialChar1xx',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i =>
                i.message === 'Must contain at least one special character'
            );
            assert.ok(issue, 'Should require a special character');
        }
    });

    test('should fail if confirmPassword does not match newPassword', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            confirmPassword: 'DifferentPass1!x',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i =>
                i.path.includes('confirmPassword') && i.message === "Passwords don't match"
            );
            assert.ok(issue, 'Should have mismatch error on confirmPassword path');
        }
    });

    test('should fail if confirmPassword is empty', () => {
        const result = passwordChangeSchema.safeParse({
            ...validPassword,
            confirmPassword: '',
        });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const issue = result.error.issues.find(i => i.path.includes('confirmPassword'));
            assert.ok(issue, 'Should have an issue on confirmPassword');
        }
    });

    test('should accept a password that meets all requirements exactly at min length', () => {
        const minValid = 'Abcdefghij1!'; // exactly 12 chars
        const result = passwordChangeSchema.safeParse({
            currentPassword: 'old',
            newPassword: minValid,
            confirmPassword: minValid,
        });
        assert.strictEqual(result.success, true, `Password "${minValid}" should be valid`);
    });
});

// ---------------------------------------------------------------------------
// apiKeySchema
// ---------------------------------------------------------------------------

describe('apiKeySchema', () => {
    test('accepts an empty string (cleared key)', () => {
        const result = apiKeySchema.safeParse('');
        assert.strictEqual(result.success, true);
    });

    test('accepts typical provider key formats', () => {
        const valid = [
            'abcDEF123',
            'pk_live_abc-def_123',
            'AV.ALPHA.1234',
            'K-1_a.b.c-d',
        ];
        for (const k of valid) {
            const result = apiKeySchema.safeParse(k);
            assert.strictEqual(result.success, true, `"${k}" should be valid`);
        }
    });

    test('trims surrounding whitespace', () => {
        const result = apiKeySchema.safeParse('  poly-key-123  ');
        assert.strictEqual(result.success, true);
        if (result.success) {
            assert.strictEqual(result.data, 'poly-key-123');
        }
    });

    test('rejects keys containing spaces or special characters', () => {
        const invalid = ['key with space', 'key/with/slash', 'key$with$dollar', 'key<script>'];
        for (const k of invalid) {
            const result = apiKeySchema.safeParse(k);
            assert.strictEqual(result.success, false, `"${k}" should be invalid`);
        }
    });

    test('rejects keys longer than 256 characters', () => {
        const result = apiKeySchema.safeParse('a'.repeat(257));
        assert.strictEqual(result.success, false);
    });
});

// ---------------------------------------------------------------------------
// preferencesSchema
// ---------------------------------------------------------------------------

describe('preferencesSchema', () => {
    const validPrefs = {
        baseCurrency: 'USD' as const,
        dateFormat: 'MM/DD/YYYY' as const,
        numberFormat: 'en-US' as const,
        defaultLandingPage: '/' as const,
        marketDataRefreshSeconds: 60,
    };

    test('accepts valid preferences', () => {
        const result = preferencesSchema.safeParse(validPrefs);
        assert.strictEqual(result.success, true);
    });

    test('rejects unknown currency codes', () => {
        const result = preferencesSchema.safeParse({ ...validPrefs, baseCurrency: 'ZZZ' });
        assert.strictEqual(result.success, false);
    });

    test('rejects unknown date format', () => {
        const result = preferencesSchema.safeParse({ ...validPrefs, dateFormat: 'MMMM-DD' });
        assert.strictEqual(result.success, false);
    });

    test('rejects refresh interval below 15 seconds', () => {
        const result = preferencesSchema.safeParse({ ...validPrefs, marketDataRefreshSeconds: 5 });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Minimum 15 seconds');
        }
    });

    test('rejects refresh interval above one hour', () => {
        const result = preferencesSchema.safeParse({ ...validPrefs, marketDataRefreshSeconds: 7200 });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Maximum 60 minutes');
        }
    });

    test('accepts refresh at boundaries', () => {
        const low = preferencesSchema.safeParse({ ...validPrefs, marketDataRefreshSeconds: 15 });
        assert.strictEqual(low.success, true);
        const high = preferencesSchema.safeParse({ ...validPrefs, marketDataRefreshSeconds: 3600 });
        assert.strictEqual(high.success, true);
    });

    test('rejects non-integer refresh seconds', () => {
        const result = preferencesSchema.safeParse({ ...validPrefs, marketDataRefreshSeconds: 30.5 });
        assert.strictEqual(result.success, false);
    });
});
