// LOCAL ONLY (npm run test:siblings). Needs the sibling clones and the workspace evidence/ folder next to this
// repository. It is not run by ci.yml or pages.yml, and `node --test` (what CI runs) finds this file but it does
// nothing unless it is started with --live, so a hosted checkout is never affected.
//
//   1. It re-runs the whole site suite (test/build.test.mjs) with SITE_SIBLINGS=live, so every check that CI makes
//      against a committed fixture is made again against the live sibling file.
//   2. It re-derives every fixture from its recorded source (the commit for a repository file; the evidence or
//      workspace file otherwise) and fails if a fixture is stale or does not match SOURCE.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!process.argv.includes('--live')) {
  console.log('test/siblings.local.test.mjs is local-only: run `npm run test:siblings` in a workspace that has the sibling clones.');
} else {
  process.env.SITE_SIBLINGS = 'live';
  const { SOURCE_JSON, FIXTURE_ROOT, WORKSPACE_ROOT, cutText, siblingPath } = await import('../scripts/sibling-fixtures.mjs');
  const sha256 = (b) => createHash('sha256').update(b).digest('hex');
  const src = JSON.parse(readFileSync(SOURCE_JSON, 'utf8'));

  test('live siblings: every sibling folder and the evidence folder this suite reads is present', () => {
    for (const repo of Object.keys(src.heads)) assert.ok(existsSync(join(WORKSPACE_ROOT, repo, '.git')), `${repo}: no clone next to this repository`);
    assert.ok(existsSync(join(WORKSPACE_ROOT, 'evidence')), 'no workspace evidence folder');
  });

  for (const f of src.files.filter((x) => x.cut.mode !== 'generated')) {
    test(`fixture ${f.repo}/${f.path} equals what its recorded source gives`, () => {
      let text;
      if (f.commit) {
        const repoDir = join(WORKSPACE_ROOT, f.repo);
        execFileSync('git', ['-C', repoDir, 'cat-file', '-e', `${f.commit}^{commit}`]);
        text = execFileSync('git', ['-C', repoDir, 'show', `${f.commit}:${f.path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      } else {
        // evidence and workspace files are not in a repository; a dockit benchmark CSV is read from its working tree until dockit is committed
        // (SITE_SIBLINGS is 'live' here, so siblingPath gives the workspace file, or for sprint-5 evidence the lane scratch copy until wrap-up)
        const file = siblingPath(f.repo, f.path);
        text = readFileSync(file, 'utf8');
      }
      assert.equal(sha256(text), f.sourceSha256, 'the source changed since the fixture was cut: run node scripts/make-sibling-fixtures.mjs');
      const fixture = readFileSync(join(FIXTURE_ROOT, f.repo, ...f.path.split('/')), 'utf8');
      assert.equal(fixture, cutText(text, f.cut), 'the fixture is not the recorded cut of its source');
      assert.equal(sha256(fixture), f.sha256);
    });
  }

  // Sprint 7: the emulated-results contract between dockit and the site: the label pattern, the failure reasons and the CSV header are the same in both repositories
  test('live siblings: the site importer of the emulated results agrees with dockit on the label pattern, the failure reasons and the CSV header', async () => {
    const dockit = await import(new URL('../../dockit/scripts/lib/bench-columns.mjs', import.meta.url));
    const mine = await import('../scripts/import-dockit-emulated.mjs');
    const fixtures = await import('../scripts/make-emulated-fixtures.mjs');
    assert.equal(mine.ENVIRONMENT_RE.source, dockit.ENVIRONMENT_LABEL_RE.source);
    assert.deepEqual(mine.FAILURE_REASONS, [...dockit.FAILURE_REASONS]);
    assert.deepEqual(fixtures.COLUMNS, [...dockit.E2E_EMULATED_COLUMNS]);
    assert.deepEqual(fixtures.Q_COLUMNS, [...dockit.Q_EMULATED_COLUMNS]);
    assert.equal(mine.CSV_FILE, dockit.EMULATED_E2E_FILE);
    assert.equal(mine.Q_FILE, dockit.EMULATED_Q_FILE);
    assert.equal(mine.NOT_MEASURED_8GB, dockit.LAPTOP_8GB);
  });

  // The limit evidence: the six columns the merge step fills, and the reading of them ('proven' needs the read-back equal AND the probe refused), are the same in both repositories
  test('live siblings: the evidence columns, the reading of them and its wording are the same in dockit and in the site importer', async () => {
    const dockit = await import(new URL('../../dockit/scripts/lib/bench-columns.mjs', import.meta.url));
    const mine = await import('../scripts/import-dockit-emulated.mjs');
    assert.deepEqual(mine.EVIDENCE_COLUMNS, [...dockit.E2E_EMULATED_COLUMNS].slice(dockit.E2E_EMULATED_COLUMNS_V1.length));
    assert.deepEqual(mine.LIMIT_PROOF_TEXT, { ...dockit.LIMIT_PROOF_TEXT });
    assert.deepEqual(mine.LIMIT_PROOFS, Object.keys(dockit.LIMIT_PROOF_TEXT));
    const limit = String(5 * 1073741824);
    const base = { job_commit_limit_bytes: limit, job_limit_readback_bytes: limit, job_limit_flags_readback: '0x2200', limit_probe_refused: 'true' };
    const rows = [
      base,
      { ...base, limit_probe_refused: 'false' },
      { ...base, limit_probe_refused: '' },
      { ...base, job_limit_readback_bytes: String(5 * 1073741824 - 4096) },
      { ...base, job_limit_flags_readback: '0x2000' },
      { ...base, job_limit_readback_bytes: '', job_limit_flags_readback: '' },
      { job_commit_limit_bytes: limit },
      { job_commit_limit_bytes: '' },
      { job_commit_limit_bytes: '', job_limit_readback_bytes: '0', job_limit_flags_readback: '0x2000' },
      { job_commit_limit_bytes: '', job_limit_readback_bytes: '1', job_limit_flags_readback: '0x2000' },
    ];
    for (const r of rows) assert.equal(mine.limitProof(r), dockit.limitProof(r), JSON.stringify(r));
  });

  // The same suite, reading the live files.
  await import('./build.test.mjs');
}
