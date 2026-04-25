#!/usr/bin/env bun
/**
 * Release script for OpenPlaud.
 *
 * Usage:
 *   bun scripts/release.ts <major|minor|patch>
 *   bun scripts/release.ts <x.y.z>
 *
 * Steps:
 *   1. Verify clean working tree on main
 *   2. Bump version in package.json
 *   3. Rewrite CHANGELOG.md: [Unreleased] -> [X.Y.Z] - <date>
 *   4. Commit (release commit), tag vX.Y.Z
 *   5. Push tag (NOT main — release commit goes through normal review/push)
 *   6. Re-add empty [Unreleased] section, commit
 *
 * The script stops after pushing the tag. GitHub workflows (docker.yml,
 * release.yml) take over from there. Per AGENTS.md, agents do not invoke
 * this — it's a maintainer action.
 *
 * Files staged are explicitly listed (package.json, CHANGELOG.md). No
 * `git add -A` / `git add .` — see AGENTS.md.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TARGET = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const STAGED_FILES = ["package.json", "CHANGELOG.md"];

if (!TARGET || (!BUMP_TYPES.has(TARGET) && !SEMVER_RE.test(TARGET))) {
	console.error("Usage: bun scripts/release.ts <major|minor|patch|x.y.z>");
	process.exit(1);
}

function run(cmd: string, opts: { silent?: boolean } = {}): string {
	if (!opts.silent) console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit" }) ?? "";
	} catch {
		console.error(`Command failed: ${cmd}`);
		process.exit(1);
	}
}

function readPkg(): { version: string } {
	return JSON.parse(readFileSync("package.json", "utf-8"));
}

function compareVersions(a: string, b: string): number {
	const ap = a.split(".").map(Number);
	const bp = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (ap[i] ?? 0) - (bp[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

function bumpVersion(target: string): string {
	const current = readPkg().version;
	if (BUMP_TYPES.has(target)) {
		run(`npm version ${target} --no-git-tag-version`);
	} else {
		if (compareVersions(target, current) <= 0) {
			console.error(`Error: ${target} must be greater than current ${current}.`);
			process.exit(1);
		}
		run(`npm version ${target} --no-git-tag-version`);
	}
	return readPkg().version;
}

function updateChangelogForRelease(version: string): void {
	const date = new Date().toISOString().split("T")[0];
	const content = readFileSync("CHANGELOG.md", "utf-8");
	if (!content.includes("## [Unreleased]")) {
		console.error("Error: CHANGELOG.md has no [Unreleased] section.");
		process.exit(1);
	}
	writeFileSync("CHANGELOG.md", content.replace("## [Unreleased]", `## [${version}] - ${date}`));
}

function addUnreleasedSection(): void {
	const content = readFileSync("CHANGELOG.md", "utf-8");
	writeFileSync("CHANGELOG.md", content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n"));
}

function stage(): void {
	run(`git add -- ${STAGED_FILES.join(" ")}`);
}

function assertCleanOnMain(): void {
	const branch = run("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
	if (branch !== "main") {
		console.error(`Error: must release from main, currently on '${branch}'.`);
		process.exit(1);
	}
	const status = run("git status --porcelain", { silent: true }).trim();
	if (status) {
		console.error("Error: uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
}

console.log("\n=== OpenPlaud Release ===\n");

assertCleanOnMain();

console.log("Bumping version...");
const version = bumpVersion(TARGET);
console.log(`  -> ${version}\n`);

console.log("Updating CHANGELOG.md...");
updateChangelogForRelease(version);

console.log("Committing release...");
stage();
run(`git commit -m "chore(release): v${version}"`);
run(`git tag v${version}`);

console.log("\nPushing tag (not main — push the release commit yourself after review)...");
run(`git push origin v${version}`);

console.log("\nAdding [Unreleased] section for next cycle...");
addUnreleasedSection();
stage();
run(`git commit -m "chore: add [Unreleased] section for next cycle"`);

console.log(`\n=== Tagged v${version} ===`);
console.log("Next steps:");
console.log("  1. git push origin main   # pushes release commit + [Unreleased] commit");
console.log("  2. Wait for docker.yml + release.yml workflows");
console.log("  3. Review and publish the draft GitHub Release");
