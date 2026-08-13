#!/usr/bin/env node
/**
 * Cuts a release.
 *
 * Bumps the version, moves the changelog's "Unreleased" entries into a dated
 * section, commits and tags. Pushing the tag is left as a separate, explicit
 * step: publishing is outward-facing and should not happen as a side effect of
 * a version bump.
 *
 *   node scripts/release.mjs patch|minor|major|<exact version> [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = join(ROOT, 'package.json');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find((arg) => !arg.startsWith('--')) ?? 'patch';

function run(command, commandArgs) {
  if (dryRun) {
    console.log(`[dry-run] ${command} ${commandArgs.join(' ')}`);
    return '';
  }
  return execFileSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(kind)) {
    return kind;
  }
  const [major, minor, patch] = current.split('-')[0].split('.').map(Number);
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return fail(`unknown bump "${kind}". Use patch, minor, major, or an exact version.`);
  }
}

// A dirty tree would put unrelated changes into the release commit.
const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
if (status.trim() !== '' && !dryRun) {
  fail('the working tree has uncommitted changes. Commit or stash them first.');
}

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
const version = nextVersion(pkg.version, bump);
const tag = `v${version}`;

const existingTags = execFileSync('git', ['tag', '--list', tag], { cwd: ROOT, encoding: 'utf8' });
if (existingTags.trim() !== '') {
  fail(`tag ${tag} already exists.`);
}

console.log(`${pkg.version} -> ${version}`);

pkg.version = version;
if (!dryRun) {
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Promote "Unreleased" to a dated section and start a fresh empty one.
const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(CHANGELOG, 'utf8');
if (!changelog.includes('## [Unreleased]')) {
  fail('CHANGELOG.md has no "## [Unreleased]" section to promote.');
}
const updated = changelog.replace(
  '## [Unreleased]',
  `## [Unreleased]\n\n## [${version}] - ${today}`
);
if (!dryRun) {
  writeFileSync(CHANGELOG, updated);
}

run('git', ['add', 'package.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
run('git', ['tag', '-a', tag, '-m', `GitHub Notifier ${tag}`]);

console.log(`
Tagged ${tag}. Nothing has been pushed.

Review it, then publish with:
  git push origin main --follow-tags

That tag starts the Release workflow, which builds the .deb and AppImage and
attaches them to a GitHub release.
`);
