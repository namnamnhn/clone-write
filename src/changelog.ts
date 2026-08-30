import changelogEntries from './changelog.json';

// Metadata is edited by hand here (no more standalone update_*.cjs scripts).
// The version history itself lives in ./changelog.json — a plain JSON file,
// so adding a new release is just adding one object to that array, no script
// runs, and nothing here can go out of sync with what's actually shipped.
export const APP_AUTHOR = "Nguyễn Trí Hiếu";
export const APP_NAME = "Dịch & Biên Tập Truyện";

export interface ChangelogChange {
    icon: string;
    bold: string;
    text: string;
}

export interface ChangelogEntry {
    version: string;
    title: string;
    isLatest: boolean;
    changes: ChangelogChange[];
}

// changelog.json is ordered newest-first; the first entry is always "latest".
export const CHANGELOG_DATA: ChangelogEntry[] = changelogEntries as ChangelogEntry[];

// Single source of truth for the app version: the newest changelog entry.
// Previously this was a separate hardcoded string that had to be bumped by
// hand in lockstep with the changelog data (and sometimes wasn't).
export const APP_VERSION = CHANGELOG_DATA[0]?.version ?? "0.0.0";
export const APP_FULL_TITLE = `${APP_NAME} v${APP_VERSION}`;
