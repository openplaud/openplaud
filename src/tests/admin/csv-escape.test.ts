import { describe, expect, it } from "vitest";

/**
 * The CSV-export route's `csvEscape` helper is currently inline. We pull it
 * out as a regex check here -- if you refactor the route, port these
 * assertions into the new home rather than letting them rot.
 *
 * Defense-in-depth guard against CSV / formula injection (OWASP class).
 */
function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) {
        s = `'${s}`;
    }
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

describe("csvEscape (formula-injection guard)", () => {
    it.each([
        ["=cmd|'/c calc.exe'!A1"],
        ["+1+1"],
        ["-something"],
        ["@SUM(A1:A2)"],
        ["\tleading-tab"],
        ["\rleading-cr"],
    ])("prefixes apostrophe to dangerous lead char: %s", (input) => {
        const out = csvEscape(input);
        // The output must contain a literal apostrophe placed before the
        // original first character. Either the cell is unquoted and starts
        // with `'`, or the cell is wrapped in double-quotes and the
        // apostrophe is at index 1 (right after the opening quote).
        const apostropheBeforeOriginal =
            out.startsWith("'") || out.startsWith(`"'`);
        expect(apostropheBeforeOriginal).toBe(true);
    });

    it("does not prefix safe values", () => {
        expect(csvEscape("hello")).toBe("hello");
        expect(csvEscape("user@example.com")).toBe("user@example.com");
        expect(csvEscape(42)).toBe("42");
    });

    it("CSV-quotes values containing comma/quote/newline", () => {
        expect(csvEscape("a,b")).toBe(`"a,b"`);
        expect(csvEscape(`a"b`)).toBe(`"a""b"`);
        expect(csvEscape("a\nb")).toBe(`"a\nb"`);
    });

    it("handles null / undefined", () => {
        expect(csvEscape(null)).toBe("");
        expect(csvEscape(undefined)).toBe("");
    });

    it("combines formula prefix + quoting when a lead-dangerous value also contains a comma", () => {
        // Real-world: a malicious email containing both a formula leader
        // AND a comma. Must produce a quoted, apostrophe-prefixed cell.
        const out = csvEscape(`=HYPERLINK("http://evil","click")`);
        // Outer wrapper quote, then the apostrophe, then the original.
        expect(out.startsWith(`"'=`)).toBe(true);
    });
});
