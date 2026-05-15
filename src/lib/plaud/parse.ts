/**
 * Defensive JSON parsing for Plaud API responses.
 *
 * Plaud's API sits behind Cloudflare. When the WAF rejects a request
 * (datacenter IP scoring, missing/wrong User-Agent, future-tightened
 * fingerprint rules, ...) the response body is HTML, not JSON. A bare
 * `await res.json()` throws `SyntaxError: Unexpected token '<'` which
 * `apiHandler` would then surface as `INTERNAL_ERROR` (500) \u2014 misleading,
 * since it isn't our bug.
 *
 * This helper:
 *   - reads the body as text
 *   - attempts `JSON.parse`
 *   - on parse failure or empty body, throws a structured `AppError`
 *     keyed off `res.status` so the route boundary surfaces the right
 *     status code and error code
 *   - includes a 200-char `bodySnippet` in `details` so server logs
 *     have something to grep when Plaud's response shape changes again
 *
 * Callers that need a typed result on the success path can still call
 * `safeParseJson<MyShape>(res)` and get a typed value back; failures
 * always throw.
 */

import { AppError, ErrorCode } from "@/lib/errors";

const BODY_SNIPPET_MAX = 200;

/**
 * Parse a Plaud API `Response` as JSON, or throw a structured
 * `AppError` if the body isn't valid JSON.
 *
 * Note: this does *not* check `res.ok` \u2014 callers may legitimately want
 * to parse a 200-body with `status: -N` business-level errors (the Plaud
 * `-302` regional redirect is one such case). The status-code branching
 * here only fires when the body itself is unparseable; if Plaud returns
 * a clean JSON error envelope at HTTP 422, this helper returns it and
 * the caller decides what to do.
 */
export async function safeParseJson<T = unknown>(res: Response): Promise<T> {
    // Prefer `.text()` because it lets us snippet the body for diagnostics
    // when the parse fails. Real `Response` objects always implement both
    // `.text()` and `.json()`; the `typeof` guard exists so test mocks
    // that only stub `.json()` keep working (the loss of the body snippet
    // in a test mock is uninteresting — the test already controls the
    // body).
    let text = "";
    let parsed: unknown;
    let didParse = false;
    let bodyReadFailed = false;
    if (typeof res.text === "function") {
        try {
            text = await res.text();
        } catch {
            // `.text()` can itself throw on aborted / killed connections
            // (Cloudflare drops the socket mid-body, undici raises a
            // TypeError, etc.). Treat it as upstream-unavailable rather
            // than letting the raw TypeError escape to `INTERNAL_ERROR`.
            bodyReadFailed = true;
        }
        if (!bodyReadFailed && text.length > 0) {
            try {
                parsed = JSON.parse(text) as T;
                didParse = true;
            } catch {
                // fall through to the structured error below
            }
        }
    } else {
        try {
            parsed = await (res.json() as Promise<T>);
            didParse = true;
        } catch {
            // fall through to the structured error below
        }
    }
    if (didParse) {
        return parsed as T;
    }

    // Body-read failure (socket drop, abort) is unambiguously transient
    // upstream-side. Surface as 502 regardless of the HTTP status we may
    // have seen on the headers — the response is unusable.
    if (bodyReadFailed) {
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud closed the connection before sending a response. Please try again later.",
            502,
            { plaudStatus: res.status },
        );
    }

    // Map HTTP status -> our error taxonomy. Mirrors the mapping in
    // `client.ts:plaudHttpError` so callers see consistent codes whether
    // the failure was an HTTP-level error or a JSON-parse failure.
    const status = res.status;
    let code: ErrorCode;
    let message: string;
    let statusCode: number;
    if (status === 401) {
        code = ErrorCode.PLAUD_INVALID_TOKEN;
        message =
            "Plaud rejected the access token. Reconnect your Plaud account.";
        statusCode = 401;
    } else if (status === 429) {
        code = ErrorCode.PLAUD_RATE_LIMITED;
        message = "Too many requests to Plaud. Please try again later.";
        statusCode = 429;
    } else if (status >= 500) {
        code = ErrorCode.PLAUD_UPSTREAM_ERROR;
        message = "Plaud is temporarily unavailable. Please try again later.";
        statusCode = 502;
    } else if (status >= 400) {
        // 4xx with non-JSON body \u2014 most commonly a Cloudflare 403
        // challenge page. Surface as a Plaud-typed 400 so the UI can
        // distinguish it from a generic server error, but include the
        // upstream status in `details` for diagnostics.
        code = ErrorCode.PLAUD_API_ERROR;
        message = `Plaud returned an unreadable response (HTTP ${status}).`;
        statusCode = 400;
    } else {
        // 2xx/3xx with a non-JSON body \u2014 shouldn't happen with Plaud
        // but classify as upstream-bad-response (502) rather than 400.
        code = ErrorCode.PLAUD_UPSTREAM_ERROR;
        message = `Plaud returned an unreadable response (HTTP ${status}).`;
        statusCode = 502;
    }

    throw new AppError(code, message, statusCode, {
        plaudStatus: status,
        bodySnippet: text.slice(0, BODY_SNIPPET_MAX),
    });
}
