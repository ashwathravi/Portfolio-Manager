import { test, describe } from 'node:test';
import assert from 'node:assert';
import { displayNameFor, firstNameFor, initialsFor, type ViewerIdentity } from './identity';

const google: ViewerIdentity = { id: 'u1', name: 'Ashwath Ravi', email: 'ash@example.com', image: null, mode: 'signed-in' };
const emailOnly: ViewerIdentity = { id: 'u2', name: null, email: 'ash.r@example.com', image: null, mode: 'signed-in' };
const local: ViewerIdentity = { id: 'dev', name: null, email: null, image: null, mode: 'local-dev' };

describe('identity', () => {
    test('a name typed in Settings wins over the account name', () => {
        assert.strictEqual(displayNameFor('Ash', google), 'Ash');
    });

    test('regression: falls back to the signed-in Google name, never "John Doe"', () => {
        assert.strictEqual(displayNameFor('', google), 'Ashwath Ravi');
        assert.strictEqual(displayNameFor('   ', google), 'Ashwath Ravi');
    });

    test('falls back to the email local part, then to neutral labels', () => {
        assert.strictEqual(displayNameFor('', emailOnly), 'ash.r');
        assert.strictEqual(displayNameFor('', local), 'Local developer');
        assert.strictEqual(displayNameFor(undefined, null), 'You');
    });

    test('firstNameFor only returns real names', () => {
        assert.strictEqual(firstNameFor('', google), 'Ashwath');
        assert.strictEqual(firstNameFor('', emailOnly), null);
        assert.strictEqual(firstNameFor('', local), null);
    });

    test('initialsFor', () => {
        assert.strictEqual(initialsFor('Ashwath Ravi'), 'AR');
        assert.strictEqual(initialsFor('ash.r'), 'AR');
        assert.strictEqual(initialsFor('You'), 'Y');
        assert.strictEqual(initialsFor(''), '?');
    });
});
