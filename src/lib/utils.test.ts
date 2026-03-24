import { test } from 'node:test';
import assert from 'node:assert';
import { cn } from './utils.ts';

test('cn - merges class names', () => {
    assert.strictEqual(cn('base', 'extra'), 'base extra');
});

test('cn - handles conditional classes', () => {
    assert.strictEqual(cn('base', true && 'is-true', false && 'is-false'), 'base is-true');
    assert.strictEqual(cn('base', { 'is-true': true, 'is-false': false }), 'base is-true');
});

test('cn - handles null and undefined', () => {
    assert.strictEqual(cn('base', null, undefined, 'extra'), 'base extra');
});

test('cn - merges tailwind classes correctly', () => {
    // twMerge handles this: later classes override earlier ones
    assert.strictEqual(cn('px-2 py-2', 'px-4'), 'py-2 px-4');
    assert.strictEqual(cn('text-red-500', 'text-blue-500'), 'text-blue-500');
});

test('cn - handles arrays', () => {
    assert.strictEqual(cn(['base', 'extra']), 'base extra');
    assert.strictEqual(cn('base', ['extra', 'more']), 'base extra more');
});

test('cn - handles nested structures', () => {
    assert.strictEqual(cn('base', ['extra', { nested: true, hidden: false }]), 'base extra nested');
});
