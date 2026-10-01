import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { Session } from 'next-auth';
import { resolveViewerIdentity } from './viewer';

const configured = { AUTH_SECRET: 's', AUTH_GOOGLE_ID: 'i', AUTH_GOOGLE_SECRET: 'g', NODE_ENV: 'test' };
const bypass = { AUTH_LOCAL_DEV_BYPASS: '1', AUTH_LOCAL_DEV_USER_ID: 'u1', NODE_ENV: 'development' };

describe('resolveViewerIdentity', () => {
    test('maps the Auth.js session user', async () => {
        const getSession = async () => ({ user: { id: 'u', name: ' Ash ', email: 'a@x.com', image: '' }, expires: '' }) as Session;
        assert.deepStrictEqual(await resolveViewerIdentity({ env: configured, getSession }), {
            name: 'Ash', email: 'a@x.com', image: null, mode: 'signed-in',
        });
    });

    test('no session yields null', async () => {
        assert.strictEqual(await resolveViewerIdentity({ env: configured, getSession: async () => null }), null);
    });

    test('session errors yield null instead of throwing', async () => {
        assert.strictEqual(await resolveViewerIdentity({ env: configured, getSession: async () => { throw new Error('db down'); } }), null);
    });

    test('local bypass is labelled as local development', async () => {
        const identity = await resolveViewerIdentity({ env: bypass, getSession: async () => { throw new Error('should not call'); } });
        assert.strictEqual(identity?.mode, 'local-dev');
    });

    test('invalid auth configuration yields null', async () => {
        assert.strictEqual(await resolveViewerIdentity({ env: { NODE_ENV: 'production' } }), null);
    });
});
