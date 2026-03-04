import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SchwabClient } from './client';

describe('SchwabClient', () => {
    it('should generate correct authorization URL', () => {
        const client = new SchwabClient('test-client-id', 'test-client-secret', 'https://127.0.0.1:8182/callback');
        const url = client.getAuthorizationUrl();

        assert.strictEqual(
            url,
            'https://api.schwabapi.com/v1/oauth/authorize?client_id=test-client-id&redirect_uri=https%3A%2F%2F127.0.0.1%3A8182%2Fcallback'
        );
    });

    it('should exchange code for tokens successfully', async (t) => {
        // Mock global fetch
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.schwabapi.com/v1/oauth/token');
            assert.strictEqual(options?.method, 'POST');

            const expectedBody = new URLSearchParams();
            expectedBody.append('grant_type', 'authorization_code');
            expectedBody.append('code', 'mock-auth-code');
            expectedBody.append('redirect_uri', 'https://127.0.0.1:8182/callback');

            assert.strictEqual(options?.body?.toString(), expectedBody.toString());

            return {
                ok: true,
                json: async () => ({
                    access_token: 'mock-access',
                    refresh_token: 'mock-refresh',
                    id_token: 'mock-id',
                    expires_in: 1800,
                    refresh_token_expires_in: 604800,
                    token_type: 'Bearer',
                    scope: 'readonly'
                })
            } as any;
        };

        try {
            const client = new SchwabClient('test-client-id', 'test-client-secret', 'https://127.0.0.1:8182/callback');
            const tokens = await client.exchangeCodeForTokens('mock-auth-code');

            assert.strictEqual(tokens.access_token, 'mock-access');
            assert.strictEqual(tokens.refresh_token, 'mock-refresh');
            assert.strictEqual(tokens.expires_in, 1800);
        } finally {
            global.fetch = originalFetch; // Restore fetch
        }
    });

    it('should throw an error on token exchange failure', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: false,
                statusText: 'Unauthorized'
            } as any;
        };

        try {
            const client = new SchwabClient('test-client-id', 'test-client-secret', 'https://127.0.0.1:8182/callback');
            await assert.rejects(
                async () => await client.exchangeCodeForTokens('invalid-code'),
                /Failed to exchange code for tokens: Unauthorized/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should fetch accounts successfully', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.schwabapi.com/trader/v1/accounts');
            assert.strictEqual((options?.headers as any)?.['Authorization'], 'Bearer valid-token');

            return {
                ok: true,
                json: async () => ([
                    { accountHash: 'hash123', accountNumber: '12345678' }
                ])
            } as any;
        };

        try {
            const client = new SchwabClient();
            const accounts = await client.getAccounts('valid-token');
            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountHash, 'hash123');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
