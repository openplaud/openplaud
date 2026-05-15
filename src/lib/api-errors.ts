/**
 * Client-side helper for the unified API error envelope.
 *
 * The server (`src/lib/errors.ts` + `apiHandler`) returns:
 *
 *     { error: string, code: ErrorCode, details?: Record<string, unknown> }
 *
 * on every failure. Use these helpers from React components / hooks /
 * the future mobile app so we never go back to string-matching on the
 * human-readable `error` field. Switch on `code` instead.
 *
 * See `docs/error-codes.md` for the full code reference.
 */

import { toast } from "sonner";
import type { ErrorCode } from "@/lib/errors";
import { buildReportBugUrl } from "@/lib/report-bug";

export interface ApiErrorBody {
    error: string;
    code: ErrorCode | string; // string fallback for older / out-of-band errors
    details?: Record<string, unknown>;
}

/**
 * Parse a non-OK `Response` into the unified error envelope. Tolerant of
 * upstream proxies that occasionally drop the JSON body or replace it with
 * HTML (5xx error pages from a load balancer, etc.) — falls back to a
 * synthetic envelope so the caller always has `{ error, code }` to switch
 * on.
 */
export async function parseApiError(response: Response): Promise<ApiErrorBody> {
    try {
        const body = (await response.json()) as Partial<ApiErrorBody>;
        if (
            body &&
            typeof body.error === "string" &&
            typeof body.code === "string"
        ) {
            return {
                error: body.error,
                code: body.code,
                ...(body.details && { details: body.details }),
            };
        }
    } catch {
        // fall through
    }
    return {
        error: response.statusText || "Request failed",
        code: "UNKNOWN_ERROR",
    };
}

/**
 * Sugar for the common case: "I just want a string to show in a toast."
 * Always returns a non-empty string.
 */
export async function getApiErrorMessage(
    response: Response,
    fallback = "Request failed",
): Promise<string> {
    const body = await parseApiError(response);
    return body.error || fallback;
}

export interface ToastApiErrorOptions {
    /** Fallback message if the server didn't send a human-readable `error`. */
    fallback?: string;
    /**
     * Short label describing what the user was doing when the error fired
     * ("connect Plaud", "send verification code", ...). Pre-fills the bug
     * report description so we don't have to guess from the errorId alone.
     */
    errorContext?: string;
}

/**
 * Toast a non-OK API response and — when the server attached an
 * `errorId` (i.e. it was a 5xx through `apiHandler`) — expose a one-click
 * "Report" action that opens a pre-filled GitHub issue with the errorId
 * baked in. For 4xx responses the toast renders without the action.
 *
 * Returns the parsed envelope so callers can still branch on `code` for
 * UI-specific recovery (e.g. routing to the reconnect flow on
 * `PLAUD_INVALID_TOKEN`).
 *
 * The Report action always opens GitHub directly — no dialog — because
 * the toast is a 5-second UI moment and the goal is single-click reporting.
 * Hosted users who prefer email discover the mailto option via the
 * footer "Report a bug" button, which opens the full dialog.
 */
export async function toastApiError(
    response: Response,
    opts: ToastApiErrorOptions = {},
): Promise<ApiErrorBody> {
    const body = await parseApiError(response);
    const message = body.error || opts.fallback || "Request failed";
    const errorId =
        typeof body.details?.errorId === "string"
            ? body.details.errorId
            : undefined;

    if (errorId) {
        const url = buildReportBugUrl({
            errorId,
            errorContext: opts.errorContext,
            page:
                typeof window !== "undefined"
                    ? window.location.pathname
                    : undefined,
        });
        toast.error(message, {
            description: errorId,
            action: {
                label: "Report",
                onClick: () => {
                    window.open(url, "_blank", "noopener,noreferrer");
                },
            },
        });
    } else {
        toast.error(message);
    }

    return body;
}
