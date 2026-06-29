import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sanitizePatternHeadlineHtml } from "./PatternRow";

describe("sanitizePatternHeadlineHtml", () => {
    test("allows detector emphasis tags and escapes other markup", () => {
        const sanitized = sanitizePatternHeadlineHtml(
            'FOMO trades cost <em>$1,200</em><img src=x onerror="alert(1)">',
        );

        assert.equal(
            sanitized,
            'FOMO trades cost <em>$1,200</em>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
        );
    });

    test("does not allow attributes on emphasis tags", () => {
        const sanitized = sanitizePatternHeadlineHtml('<em onclick="alert(1)">Risk</em>');

        assert.equal(sanitized, '&lt;em onclick=&quot;alert(1)&quot;&gt;Risk</em>');
    });
});
