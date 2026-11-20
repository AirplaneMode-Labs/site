import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sprint 7 (TD-116, TD-117, TD-120): the README names the live demo on its first screen, the issue forms keep real documents out of issues, and the release
// note says what the Pages deploy is. These read this repository's own files only.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('the README has the Live demo line within its first 12 lines (TD-116)', () => {
  assert.ok(read('README.md').split('\n').slice(0, 12).includes('Live demo: https://airplanemode-labs.github.io/site/'));
});

test('bug_report.yml carries the required no-real-documents checkbox and asks for redaction (TD-117)', () => {
  const y = read('.github/ISSUE_TEMPLATE/bug_report.yml');
  assert.ok(y.includes('I have not attached any real, confidential or personal document (bank, legal, medical, identity). Any sample is synthetic or public.'));
  assert.match(y, /type: checkboxes/);
  assert.match(y, /required: true/);
  assert.match(y, /redact/i);
  assert.match(y, /SECURITY\.md/);
});

test('feature_request.yml exists; config.yml disables blank issues and links SECURITY.md; SECURITY.md says to report privately, never in a public issue', () => {
  assert.match(read('.github/ISSUE_TEMPLATE/feature_request.yml'), /type: textarea/);
  const c = read('.github/ISSUE_TEMPLATE/config.yml');
  assert.match(c, /blank_issues_enabled: false/);
  assert.match(c, /contact_links:/);
  assert.ok(c.includes('https://github.com/AirplaneMode-Labs/site/blob/main/SECURITY.md'));
  assert.match(read('SECURITY.md').replace(/\s+/g, ' '), /never in a public issue/i);
  assert.match(read('CONTRIBUTING.md'), /real, confidential/i);
});

test('docs/release.md says the site is never published to a registry and that the Pages deploy is the release (TD-120); the README says it too', () => {
  const sentence = 'never published to a registry; the Pages deploy is the release';
  assert.ok(existsSync(join(root, 'docs', 'release.md')));
  assert.ok(read('docs/release.md').includes(sentence));
  assert.ok(read('README.md').replace(/\s+/g, ' ').includes(sentence));
  assert.match(read('docs/release.md'), /not tagged|no tag/);
});

test('the CHANGELOG has a Sprint 7 entry in the Keep a Changelog form, untagged, and says the site makes no claim about stars or pilots', () => {
  const c = read('CHANGELOG.md');
  assert.match(c, /^## \[0\.1\.0-dev\] - 2026-11-20 \(untagged\)$/m);
  assert.match(c, /### Added/);
  assert.doesNotMatch(c.slice(0, c.indexOf('## [0.1.0-dev] - 2026-11-19')), /\bwill (gain|reach|get) \d+ stars\b|expect \d+ stars/i);
});

test('the site package version is 0.1.0-dev (TD-107)', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.1.0-dev');
});
