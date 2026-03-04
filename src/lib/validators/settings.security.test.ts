import { describe, it } from 'node:test';
import assert from 'node:assert';
import { profileSchema, passwordChangeSchema } from './settings';

describe('Security: Profile Schema Vulnerabilities', () => {
    it('should reject XSS payloads in phone number', () => {
        // We need a shorter payload to fit within 20 chars
        const shortXss = '<b onclick=alert(1)>'; // 20 chars

        const maliciousProfile = {
            fullName: 'John Doe',
            email: 'john@example.com',
            phone: shortXss
        };

        const result = profileSchema.safeParse(maliciousProfile);

        assert.strictEqual(result.success, false, 'Phone field accepted XSS payload');
    });

    it('should reject extremely long passwords to prevent hashing DoS', () => {
        // Create a password that meets complexity requirements but is too long
        // Needs: Uppercase, Lowercase, Number, Special char
        const longPassword = 'A1!' + 'a'.repeat(10000);

        const result = passwordChangeSchema.safeParse({
            currentPassword: longPassword,
            newPassword: longPassword,
            confirmPassword: longPassword
        });

        assert.strictEqual(result.success, false, 'Schema accepted extremely long password');
    });

    it('should reject extremely long emails to prevent database truncation issues', () => {
        const longEmail = 'a'.repeat(300) + '@example.com';
        const result = profileSchema.safeParse({
            fullName: 'John Doe',
            email: longEmail,
            phone: '1234567890'
        });

        assert.strictEqual(result.success, false, 'Schema accepted extremely long email');
    });
});
