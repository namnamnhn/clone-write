#!/usr/bin/env node
/**
 * Single script to add a new version entry to the changelog.
 *
 * Replaces the old update_changelog*.cjs / update_safety*.cjs / update_tier.cjs /
 * update_migration.cjs / update_metadata.cjs / update_format.cjs / revert_version.js /
 * generate_changelog.cjs scripts (archived in _archive_scratch/root/), each of which
 * used to hand-patch a giant src/changelog.ts template-literal string for one version
 * bump and then get thrown away. That pattern is how src/changelog.ts grew to 88K and
 * how it silently ended up with two entries marked "isLatest: true" at once.
 *
 * Now src/changelog.json is the single source of truth (plain JSON, safe to hand-edit
 * directly too), src/changelog.ts just reads it, and APP_VERSION is derived from the
 * newest entry — so this script is the only thing that needs to touch two files
 * (changelog.json + package.json) and it keeps them in sync automatically.
 *
 * Usage:
 *   node scripts/add-changelog-entry.cjs <version> "<title>" \
 *     "<icon>|<bold label>|<description text>" \
 *     "<icon>|<bold label>|<description text>" ...
 *
 * Example:
 *   node scripts/add-changelog-entry.cjs 11.4.1 "Sửa lỗi Quota Flash Lite" \
 *     "Wrench|Sửa Lỗi Quota:|Khắc phục lỗi tính sai quota còn lại cho Flash Lite." \
 *     "Zap|Tối Ưu Retry:|Giảm thời gian chờ giữa các lần retry khi bị rate-limit."
 *
 * Icon names must exist in the IconMap inside src/components/modals/ChangelogModal.tsx
 * (they're lucide-react icon component names, e.g. Wrench, Zap, ShieldCheck, Cpu...).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG_JSON_PATH = path.join(ROOT, 'src', 'changelog.json');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');

function fail(msg) {
    console.error('Error: ' + msg);
    process.exit(1);
}

function main() {
    const [version, title, ...changeArgs] = process.argv.slice(2);

    if (!version || !title) {
        fail(
            'Missing arguments.\n\n' +
            'Usage: node scripts/add-changelog-entry.cjs <version> "<title>" "<icon>|<bold>|<text>" ...'
        );
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        fail(`Version "${version}" doesn't look like semver (expected e.g. 11.4.1).`);
    }
    if (changeArgs.length === 0) {
        fail('Provide at least one change as "icon|bold|text".');
    }

    const changes = changeArgs.map((raw, i) => {
        const parts = raw.split('|');
        if (parts.length !== 3) {
            fail(`Change #${i + 1} must have exactly 3 "|"-separated parts (icon|bold|text), got: ${raw}`);
        }
        const [icon, bold, text] = parts.map(s => s.trim());
        if (!icon || !bold || !text) {
            fail(`Change #${i + 1} has an empty icon/bold/text part: ${raw}`);
        }
        return { icon, bold, text };
    });

    const changelogData = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, 'utf-8'));

    if (changelogData.some(e => e.version === version)) {
        fail(`Version ${version} already exists in changelog.json.`);
    }

    // New entry goes on top; every existing entry loses "isLatest".
    for (const entry of changelogData) {
        entry.isLatest = false;
    }
    changelogData.unshift({
        version,
        title,
        isLatest: true,
        changes,
    });

    fs.writeFileSync(CHANGELOG_JSON_PATH, JSON.stringify(changelogData, null, 4) + '\n', 'utf-8');

    // Keep package.json's version field in sync (App version is derived from
    // changelog.json at runtime, but package.json's own version field is a
    // separate, conventional piece of metadata npm/tools may read).
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
    pkg.version = version;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    console.log(`Added changelog entry ${version} — "${title}" (${changes.length} change${changes.length > 1 ? 's' : ''}).`);
    console.log('Updated: src/changelog.json, package.json');
}

main();
