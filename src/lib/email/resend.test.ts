import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { EmailSendError, RESEND_EMAILS_URL, resendSender, type OutgoingEmail } from "./resend";

const EMAIL: OutgoingEmail = {
    to: "user@example.test",
    subject: "Alert: AAPL closed at $210.00",
    html: "<p>hi</p>",
    text: "hi",
    headers: { "List-Unsubscribe": "<https://atlas.example.test/api/email/unsubscribe?token=t&list=alerts>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    idempotencyKey: "alerts/abc",
    category: "alerts",
};

function fetchAnswering(status: number, body: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { fetchImpl, calls };
}

describe("resendSender (launch item i58)", () => {
    test("posts the email to Resend with the key in a header and an idempotency key", async () => {
        const { fetchImpl, calls } = fetchAnswering(200, { id: "email-1" });
        const send = resendSender({ apiKey: "re_secret", from: "Atlas Wealth <alerts@mail.example.test>" }, fetchImpl);

        assert.deepEqual(await send(EMAIL), { id: "email-1" });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, RESEND_EMAILS_URL);
        assert.equal(calls[0].init.method, "POST");
        assert.deepEqual(calls[0].init.headers, {
            Authorization: "Bearer re_secret",
            "Content-Type": "application/json",
            "Idempotency-Key": "alerts/abc",
        });
        assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
            from: "Atlas Wealth <alerts@mail.example.test>",
            to: ["user@example.test"],
            subject: EMAIL.subject,
            html: EMAIL.html,
            text: EMAIL.text,
            headers: EMAIL.headers,
            tags: [{ name: "category", value: "alerts" }],
        });
        assert.ok(!String(calls[0].init.body).includes("re_secret"), "the key never goes in the body");
    });

    test("a refusal says Resend's status and error name, never its message", async () => {
        const { fetchImpl } = fetchAnswering(422, { statusCode: 422, name: "validation_error", message: "Invalid `to` field: user@example.test" });
        const send = resendSender({ apiKey: "k", from: "f" }, fetchImpl);
        await assert.rejects(send(EMAIL), (error: unknown) => {
            assert.ok(error instanceof EmailSendError);
            assert.equal(error.status, 422);
            assert.equal(error.message, "Resend refused the email (HTTP 422, validation_error).");
            return true;
        });
    });

    test("an answer that isn't JSON, or a name that isn't one, is reported by status alone", async () => {
        for (const body of ["<html>Bad gateway</html>", { name: "Some <b>thing</b>" }]) {
            const send = resendSender({ apiKey: "k", from: "f" }, fetchAnswering(502, body).fetchImpl);
            await assert.rejects(send(EMAIL), { message: "Resend refused the email (HTTP 502)." });
        }
    });

    test("an accepted email without an ID is an error, not a silent success", async () => {
        const send = resendSender({ apiKey: "k", from: "f" }, fetchAnswering(200, {}).fetchImpl);
        await assert.rejects(send(EMAIL), { message: "Resend's answer had no email ID." });
    });

    test("a network failure or timeout is an error with no status", async () => {
        const failing = (async () => {
            throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        }) as typeof fetch;
        await assert.rejects(resendSender({ apiKey: "k", from: "f" }, failing)(EMAIL), (error: unknown) =>
            error instanceof EmailSendError && error.status === null && error.message === "Resend timed out.");
        const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
        await assert.rejects(resendSender({ apiKey: "k", from: "f" }, offline)(EMAIL), { message: "Resend couldn't be reached." });
    });
});
