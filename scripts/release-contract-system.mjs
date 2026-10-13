// One-time release of PR #54. Runs on a GitHub-hosted runner, never on a user's PC.
// No database contents, signed URLs, credentials or raw CLI errors go to public logs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE = Object.freeze({
  repo: 'mugilives-max/stepwise-kobetsu',
  source: '67a82aa432ec207329efb12949c4bb7eeab43fcf',
  base: 'e3852e0e6a945c659fb719972d8f33999259d71f',
  worker: 'stepwise-api',
  previousVersionPrefix: '0d48507b',
  db: '91ea045c-94a4-413f-91c1-1e29ebe6eb24',
  bucket: 'stepwise-files',
  migration: '0023_contract_history.sql',
});
const bootstrapFiles = new Set(['.github/workflows/contract-release.yml',
  'scripts/release-contract-system.mjs', 'test/release-contract-system.test.mjs']);
export function ensure(ok, message) { if (!ok) throw new Error(message); }
export function assertDiff(diff, allowBootstrap = false) {
  ensure(['identical', 'ahead'].includes(diff.status), 'Git history diverged; review the release again.');
  ensure(Array.isArray(diff.files) && diff.files.length < 300, 'Cannot verify the complete Git difference.');
  ensure(diff.files.every(f => f.filename.startsWith('docs/') ||
    (allowBootstrap && bootstrapFiles.has(f.filename))), 'Application source changed; review and retest first.');
}
export function assertPrivateBucket(managed, custom) {
  ensure(managed?.enabled === false && Array.isArray(custom?.domains) &&
    custom.domains.every(d => d.enabled === false), 'Backup bucket privacy could not be verified.');
}
export function assertMigrations(local, applied) {
  ensure(new Set(applied).size === applied.length, 'Duplicate migration records.');
  ensure(applied.every(n => local.includes(n)), 'Unknown production migration; stop.');
  const missing = local.filter(n => !applied.includes(n));
  ensure(missing.length === 1 && missing[0] === RELEASE.migration, 'Expected only migration 0023 to be pending.');
}
export function activeDeployment(result) {
  const d = result?.deployments?.[0];
  ensure(d?.versions?.length === 1 && d.versions[0].percentage === 100, 'Expected one fully active Worker version.');
  return { deploymentId: d.id, versionId: d.versions[0].version_id };
}
export function assertPreserved(before, after) {
  ensure(JSON.stringify(before) === JSON.stringify(after), 'Existing records changed during migration; stop before publication and investigate.');
}
export async function release(io) {
  await io.checkSource();
  const state = await io.preflight();
  const backup = await io.backup(state);
  ensure(backup.verified === true, 'Verified private backup required.');
  await io.checkUnchanged(state);
  await io.migrate();
  await io.verifyPreserved(state);
  await io.checkWorkerUnchanged(state);
  const deployed = await io.deploy();
  await io.verifyDeployment(deployed);
  await io.finish(state, deployed);
  return deployed;
}
export function runWrangler(cwd, args) {
  const r = spawnSync(process.execPath, [join(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8', timeout: 8 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never include stdout/stderr: export output may contain signed download URLs.
  ensure(r.status === 0, 'Wrangler step failed; raw output was withheld to protect private data.');
}
const digest = data => createHash('sha256').update(data).digest('hex');
const qid = value => '"' + value.replaceAll('"', '""') + '"';
const tables = ['termsConsents', 'conditions', 'specials', 'planLines', 'families', 'students', 'files', 'settings'];
export async function main() {
  ensure(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_REPOSITORY === RELEASE.repo,
    'Run manually from the main branch in GitHub Actions.');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '', token = process.env.CLOUDFLARE_API_TOKEN || '';
  ensure(/^[a-f0-9]{32}$/.test(account) && token.length > 20, 'Register CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in repository Secrets.');
  const cwd = resolve('release-source');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  ensure(head.status === 0 && head.stdout.trim() === RELEASE.source, 'Unexpected release checkout.');
  const dir = await mkdtemp(join(tmpdir(), 'stepwise-contract-release-'));
  const prefix = 'release-backups/contracts-20261013/' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
  let stage = 'initial checks', manifest;
  async function cf(path, data, raw = false) {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token, ...(data === undefined ? {} : {'Content-Type': 'application/json'}) },
      ...(data === undefined ? {} : {body: JSON.stringify(data)}),
      signal: AbortSignal.timeout(60000),
    });
    ensure(r.ok, 'Cloudflare request failed (HTTP ' + r.status + ').');
    if (raw) return { data: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
    const j = await r.json();
    ensure(j.success === true, 'Cloudflare did not confirm success.');
    return j.result;
  }
  async function gh(path) {
    const r = await fetch('https://api.github.com/repos/' + RELEASE.repo + path, {
      headers: { Authorization: 'Bearer ' + process.env.GH_READ_TOKEN, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    ensure(r.ok, 'Could not verify the GitHub release reference.');
    return r.json();
  }
  async function query(sql) {
    const data = await cf('/d1/database/' + RELEASE.db + '/query', {sql});
    ensure(Array.isArray(data) && data.every(r => r.success === true && Array.isArray(r.results)), 'Incomplete D1 query result.');
    return data;
  }
  const rows = async sql => (await query(sql))[0].results;
  const deployment = async () => activeDeployment(await cf('/workers/scripts/' + RELEASE.worker + '/deployments'));
  async function privacy() {
    const p = '/r2/buckets/' + RELEASE.bucket + '/domains/';
    assertPrivateBucket(await cf(p + 'managed'), await cf(p + 'custom'));
  }
  async function snapshot(columns) {
    const results = await query(tables.map(t => 'SELECT ' + columns[t].map(qid).join(',') + ' FROM ' + qid(t)).join(';'));
    ensure(results.length === tables.length, 'Incomplete contract snapshot.');
    return Object.fromEntries(tables.map((t, i) => [t, results[i].results.map(r =>
      columns[t].map(c => r[c])).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  }
  function cli(args) { runWrangler(cwd, args); }
  async function savePrivate(name, data) {
    await privacy();
    const file = join(dir, name), check = join(dir, 'verify-' + name), object = RELEASE.bucket + '/' + prefix + '/' + name;
    await writeFile(file, data, {mode: 0o600});
    cli(['r2', 'object', 'put', object, '--file', file, '--remote', '--config', 'cf/wrangler.jsonc']);
    cli(['r2', 'object', 'get', object, '--file', check, '--remote', '--config', 'cf/wrangler.jsonc']);
    ensure(digest(data) === digest(await readFile(check)), 'Private backup read-back did not match.');
  }
  const io = {
    async checkSource() {
      stage = 'source validation';
      const pr = await gh('/pulls/54');
      ensure(pr.state === 'open' && !pr.merged && pr.head.repo.full_name === RELEASE.repo, 'PR #54 is not the expected open release.');
      assertDiff(await gh('/compare/' + RELEASE.source + '...' + pr.head.sha));
      const main = await gh('/git/ref/heads/main');
      assertDiff(await gh('/compare/' + RELEASE.base + '...' + main.object.sha), true);
      const run = await gh('/actions/runs/38346311055');
      ensure(run.conclusion === 'success' && run.head_sha === RELEASE.source, 'The pinned application checks are not successful.');
    },
    async preflight() {
      stage = 'production preflight';
      await privacy();
      const healthResponse = await fetch('https://stepwise-api.stepwise-edu.workers.dev/', {signal: AbortSignal.timeout(60000)});
      const health = await healthResponse.json();
      ensure(healthResponse.ok && health.ok === true && health.release === '2026-10-13-plan-presentation', 'Production release changed; review it before publishing.');
      const old = await deployment();
      ensure(old.versionId.startsWith(RELEASE.previousVersionPrefix), 'Production Worker changed; inspect it before publishing.');
      const local = (await readdir(join(cwd, 'cf/migrations-v2'))).filter(n => n.endsWith('.sql')).sort();
      assertMigrations(local, (await rows('SELECT name FROM d1_migrations ORDER BY name')).map(r => r.name));
      const columns = {};
      for (const table of tables) columns[table] = (await rows('PRAGMA table_info(' + qid(table) + ')')).map(r => r.name);
      ensure(Object.values(columns).every(c => c.length > 0), 'A required contract table is missing.');
      const data = await snapshot(columns);
      return {old, columns, data};
    },
    async backup(state) {
      stage = 'verified private backup';
      cli(['d1', 'export', 'DB2', '--remote', '--config', 'cf/wrangler.jsonc', '--output', join(dir, 'db2.sql')]);
      const sql = await readFile(join(dir, 'db2.sql'));
      ensure(sql.length > 100 && sql.includes(Buffer.from('CREATE TABLE')), 'Database export is empty or incomplete.');
      await savePrivate('db2.sql', sql);
      const worker = await cf('/workers/scripts/' + RELEASE.worker, undefined, true);
      ensure(worker.data.length > 100, 'Worker backup is empty.');
      await savePrivate('worker-before.bin', worker.data);
      manifest = {source: RELEASE.source, at: new Date().toISOString(), before: state.old,
        workerContentType: worker.type, dbHash: digest(sql), workerHash: digest(worker.data),
        counts: Object.fromEntries(tables.map(t => [t, state.data[t].length]))};
      await savePrivate('contracts-before.json', Buffer.from(JSON.stringify(state)));
      await savePrivate('manifest-before.json', Buffer.from(JSON.stringify(manifest)));
      console.log('Private database and Worker backups saved and read-back verified.');
      return {verified: true};
    },
    async checkUnchanged(state) {
      stage = 'last pre-migration comparison';
      await io.checkWorkerUnchanged(state);
      assertPreserved(state.data, await snapshot(state.columns));
    },
    async migrate() {
      stage = 'D1 migration 0023';
      cli(['d1', 'migrations', 'apply', 'DB2', '--remote', '--config', 'cf/wrangler.jsonc']);
    },
    async verifyPreserved(state) {
      stage = 'post-migration preservation';
      const after = await snapshot(state.columns);
      assertPreserved(state.data, after);
      const revisionCount = (await rows('SELECT COUNT(*) AS n FROM planRevisions'))[0].n;
      ensure(revisionCount === state.data.planLines.length, 'The initial plan archive count does not match.');
      const applied = await rows("SELECT name FROM d1_migrations WHERE name='0023_contract_history.sql'");
      ensure(applied.length === 1, 'Migration 0023 was not recorded.');
      await savePrivate('manifest-migrated.json', Buffer.from(JSON.stringify({...manifest, migration: RELEASE.migration, preservation: true})));
      console.log('Migration 0023 applied; every captured existing contract column and file record is unchanged.');
    },
    async checkWorkerUnchanged(state) {
      ensure(JSON.stringify(await deployment()) === JSON.stringify(state.old), 'Concurrent Worker deployment detected; stop.');
    },
    async deploy() {
      stage = 'Worker publication';
      cli(['deploy', '--config', 'cf/wrangler.jsonc', '--keep-vars']);
      return deployment();
    },
    async verifyDeployment(deployed) {
      stage = 'Worker verification';
      ensure(deployed.versionId !== manifest.before.versionId, 'No new active Worker version was observed.');
      const response = await fetch('https://stepwise-api.stepwise-edu.workers.dev/', {signal: AbortSignal.timeout(60000)});
      const health = await response.json();
      ensure(response.ok && health.ok === true && health.release === '2026-10-13-contract-history', 'Public API health check failed; inspect before merging Pages.');
    },
    async finish(state, deployed) {
      stage = 'release record';
      await savePrivate('manifest-published.json', Buffer.from(JSON.stringify({...manifest, after: deployed, migration: RELEASE.migration, preservation: true})));
      const summary = '## Contract Worker publication\n\nSource: ' + RELEASE.source +
        '\n\nPrivate backups verified; migration 0023 applied; existing contract columns and file records preserved.' +
        '\n\nWorker version: ' + deployed.versionId +
        '\n\nPR #54 remains unmerged. Verify the staff/test-family read-only screens, then merge #54 and verify Pages. Terms activation and family notices were not performed.\n';
      await writeFile(process.env.GITHUB_STEP_SUMMARY, summary);
      console.log('Worker published and healthy. Pages and authenticated screen verification remain.');
    },
  };
  try { await release(io); }
  catch (error) {
    // Controlled messages only; unexpected fetch/CLI errors can include private URLs.
    const safe = error instanceof Error && !/https?:|Bearer|token=|password/i.test(error.message) ? error.message : 'Details withheld.';
    console.error('Stopped during ' + stage + ': ' + safe);
    console.error('No automatic rollback or database retry. Inspect private backups and the migration/deployment state before continuing.');
    process.exitCode = 1;
  } finally { await rm(dir, {recursive: true, force: true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Release initialization failed; no publication confirmed.'); process.exitCode = 1; });
}
