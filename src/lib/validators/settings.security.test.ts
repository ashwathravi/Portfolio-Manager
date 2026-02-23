import { describe, it } from 'node:test';
import assert from 'node:assert';
import { profileSchema } from './settings';

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

        // This test should FAIL if the vulnerability exists (because schema accepts it)
        // We want the result.success to be false for a secure schema.
        // If result.success is true, we have a vulnerability.
        assert.strictEqual(result.success, false, 'Phone field accepted XSS payload');
    });
});
