import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The GitHub Actions workflows pin each action to a commit, with the release
// it is in as a comment. Dependabot moves the pin and rewrites the comment,
// but it once left `# v4` beside a commit that was v7.0.1, so the comment
// names the exact release and one commit always has the same one. Checking a
// commit's tag needs GitHub:
//   gh api repos/<owner>/<action>/git/matching-refs/tags/v
const WORKFLOWS = '.github/workflows';

interface Pin {
    where: string;
    action: string;
    ref: string;
    comment: string | null;
}

function pins(): Pin[] {
    return readdirSync(WORKFLOWS)
        .filter((name) => /\.ya?ml$/.test(name))
        .flatMap((name) => readFileSync(join(WORKFLOWS, name), 'utf8').split('\n').flatMap((line, index) => {
            const match = /^\s*(?:-\s*)?uses:\s*([^@\s]+)@(\S+)(?:\s+#\s*(.+?))?\s*$/.exec(line);
            if (!match || match[1].startsWith('./')) return [];
            return [{ where: `${name}:${index + 1}`, action: match[1], ref: match[2], comment: match[3] ?? null }];
        }));
}

describe('workflow action pins', () => {
    test('finds the actions the workflows use', () => {
        assert.ok(pins().some((pin) => pin.action === 'actions/checkout'));
    });

    test('every action is pinned to a full commit SHA with its exact release as a comment', () => {
        for (const pin of pins()) {
            assert.match(pin.ref, /^[0-9a-f]{40}$/, `${pin.where}: ${pin.action} is not pinned to a commit`);
            assert.match(pin.comment ?? '', /^v\d+\.\d+\.\d+$/, `${pin.where}: ${pin.action} needs its release as "# vX.Y.Z"`);
        }
    });

    test('one commit has one release comment everywhere it is used', () => {
        const seen = new Map<string, Pin>();
        for (const pin of pins()) {
            const key = `${pin.action.split('/').slice(0, 2).join('/')}@${pin.ref}`;
            const first = seen.get(key);
            if (first) assert.equal(pin.comment, first.comment, `${pin.where} and ${first.where} name different releases for ${key}`);
            else seen.set(key, pin);
        }
    });
});
