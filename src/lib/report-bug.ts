/**
 * Bug-report URL builders.
 *
 * Two entry points, same payload:
 *   - `buildReportBugUrl`     -> pre-filled GitHub Issue Form
 *   - `buildReportBugMailto`  -> pre-filled mailto link to support
 *
 * GitHub Issue Forms support per-field query-string pre-filling via
 * `?<field-id>=<value>`. The field IDs are taken from
 * `.github/ISSUE_TEMPLATE/bug_report.yml` and must stay in sync with it:
 *   - `description`, `deployment`, `version`, `additional`
 *
 * The mailto path is reserved for hosted users (self-hosters aren't
 * our customers and `support@openplaud.com` would just confuse them).
 * The caller decides whether to render the mailto button based on
 * `isHosted`; this module just builds URLs.
 *
 * Pure and isomorphic \u2014 no DOM, no env. Callers pass `isHosted` in.
 */

import { APP_VERSION_TAG } from "@/lib/version";

/** Hosted support inbox. Marketing surface, hardcoded by design. */
export const SUPPORT_EMAIL = "support@openplaud.com";

const GITHUB_NEW_ISSUE_URL =
    "https://github.com/openplaud/openplaud/issues/new";
const BUG_REPORT_TEMPLATE = "bug_report.yml";

export interface ReportBugOptions {
    /**
     * Short correlation id from the error envelope (`details.errorId`).
     * When present, included in the pre-filled body so support can grep
     * server logs by this id.
     */
    errorId?: string;
    /**
     * Short label describing what the user was doing when the error
     * fired ("connect Plaud", "send verification code", ...). Pre-fills
     * the issue description.
     */
    errorContext?: string;
    /**
     * Current page path (e.g. `/dashboard`). Helps triage figure out
     * which surface the user was on.
     */
    page?: string;
    /**
     * Whether this OpenPlaud instance is running in hosted mode.
     * Passed in by the caller (server reads `env.IS_HOSTED`). Optional
     * because client-side entry points (the error toast `[Report]`
     * action) don't have `env.IS_HOSTED` available — in that case the
     * deployment field is left unfilled and the user picks it from
     * the GitHub form dropdown. Server-side entry points (the footer
     * dialog) always pass it.
     */
    isHosted?: boolean;
}

/**
 * Build a pre-filled GitHub Issue Form URL. The form remains user-driven
 * (steps to reproduce, expected/actual behavior); we only pre-fill the
 * fields we already know to save the user typing.
 */
export function buildReportBugUrl(opts: ReportBugOptions): string {
    const params = new URLSearchParams({
        template: BUG_REPORT_TEMPLATE,
        version: APP_VERSION_TAG,
    });

    // Only pre-fill `description` when we have something concrete to put
    // there (errorId, errorContext). For the footer "just want to report
    // something" path, leaving description empty is better than seeding
    // a placeholder string the user has to delete.
    const description = buildDescription(opts);
    if (description) {
        params.set("description", description);
    }

    // Only pre-fill `deployment` when we know it. The GitHub Issue Form
    // marks the dropdown as required, so an unset value just means the
    // user picks it themselves — better than guessing wrong.
    if (opts.isHosted !== undefined) {
        params.set(
            "deployment",
            opts.isHosted ? "Hosted (openplaud.com)" : "Self-hosted",
        );
    }

    const additional = buildAdditional(opts);
    if (additional) {
        params.set("additional", additional);
    }

    return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * Build a pre-filled mailto URL. Only meaningful for hosted users \u2014
 * self-hosters should use GitHub. Caller is responsible for not
 * exposing this in self-host UI.
 */
export function buildReportBugMailto(opts: ReportBugOptions): string {
    const subject = opts.errorId
        ? `OpenPlaud bug report (${opts.errorId})`
        : "OpenPlaud bug report";
    const body = [buildDescription(opts), "", "---", buildAdditional(opts)]
        .filter(Boolean)
        .join("\n");

    // RFC 6068 `mailto:` URIs require `%20` for spaces in the query.
    // `URLSearchParams` emits `+` (application/x-www-form-urlencoded
    // semantics), which several mail clients (notably some macOS Mail
    // and Outlook builds) render literally instead of decoding to space,
    // garbling the prefilled subject + body. Encode manually with the
    // mailto-correct conventions.
    const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return `mailto:${SUPPORT_EMAIL}?${qs}`;
}

/**
 * Produces the prose preview the dialog shows the user before they
 * click. Same content drives both GitHub `description` and mailto body.
 */
export function buildReportBugBodyPreview(opts: ReportBugOptions): string {
    const parts = [buildDescription(opts), "", buildAdditional(opts)].filter(
        Boolean,
    );
    return parts.join("\n");
}

// ---- helpers --------------------------------------------------------------

/**
 * Build the pre-filled `description` body. Returns an empty string when
 * there's nothing concrete to seed (no errorId, no errorContext) so the
 * caller can omit the param entirely and let the user start from a clean
 * textarea.
 */
function buildDescription(opts: ReportBugOptions): string {
    const lines: string[] = [];
    if (opts.errorContext) {
        lines.push(`While trying to: ${opts.errorContext}`);
    }
    if (opts.errorId) {
        if (lines.length > 0) lines.push("");
        lines.push(`Error id: \`${opts.errorId}\``);
    }
    return lines.join("\n");
}

function buildAdditional(opts: ReportBugOptions): string {
    const lines: string[] = [];
    if (opts.page) {
        lines.push(`Page: \`${opts.page}\``);
    }
    lines.push(`Version: ${APP_VERSION_TAG}`);
    if (opts.isHosted !== undefined) {
        lines.push(
            `Mode: ${opts.isHosted ? "Hosted (openplaud.com)" : "Self-hosted"}`,
        );
    }
    return lines.join("\n");
}
