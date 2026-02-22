import { describe, expect, it } from "vitest";
import { cn } from "../lib/utils";

describe("Utils", () => {
    describe("cn (classnames)", () => {
        it("should join strings", () => {
            expect(cn("a", "b", "c")).toBe("a b c");
        });

        it("should filter out falsy values", () => {
            expect(cn("a", false && "b", "c")).toBe("a c");
            expect(cn("a", null, "c")).toBe("a c");
            expect(cn("a", undefined, "c")).toBe("a c");
            expect(cn("a", 0, "c")).toBe("a c");
        });

        it("should handle objects", () => {
            expect(cn("a", { b: true, c: false, d: true })).toBe("a b d");
        });

        it("should merge classes from arrays", () => {
            expect(cn(["a", "b"], ["c", "d"])).toBe("a b c d");
        });

        it("should handle deeply nested objects", () => {
            expect(cn("base", { nested: { value: true } })).toBe("base nested");
        });

        it("should override classes with later truthy values", () => {
            expect(cn("first", "second")).toBe("first second");
        });

        it("should handle template literals", () => {
            expect(cn(`prefix-${"item"}`)).toBe("prefix-item");
        });
    });
});
