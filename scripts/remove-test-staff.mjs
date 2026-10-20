// One-time removal of the two test teachers registered in production on 2026-10-17 (before the staging environment existed).
// Owner request 2026-10-20: 「ここのテストのユーザを削除したい」→「消してよい」. GitHub-only, like the release scripts:
// inspect (read only) → remove (private backup first). Runs on a GitHub-hosted runner; no row contents go to public logs.
// The retention triggers that block deletes on contracts, contract events, registrations and work days are dropped only for this
// one batch and recreated from their exact saved SQL; the run then checks they are identical and that no other record changed.
// auditLog entries are kept (append-only history); one entry records this removal.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ensure as check, runWrangler, assertPrivateBucket, assertRecordsPreserved } from './release-contract-system.mjs';

const repo = 'mugilives-max/stepwise-kobetsu', branch = 'claude/test-staff-removal-20261020', db = '91ea045c-94a4-413f-91c1-1e29ebe6eb24', bucket = 'stepwise-files';
const backupRoot = 'release-backups/test-staff-removal-20261020/';
const TARGETS = { st_b300f2f195f931bccfab4bb6: '【テスト】 登録確認', st_5ee74a97bdd5ffdac21ee393: '【テスト】 本人登録２' };
const RETAIN = ['employmentContractRetain', 'employmentEventsNoDelete', 'staffRegistrationRequestRetain', 'staffRegistrationReviewRetain', 'workDayRevisionRetain', 'workDayRetain'];
const ids = Object.keys(TARGETS), inIds = '(' + ids.map(i => `'${i}'`).join(',') + ')';
// Children first (foreign keys). Each entry: [table, where].
const PLAN = [
  ['workDayRevisions', `workDayId in (select id from workDays where staffId in ${inIds})`],
  ['workDays', `staffId in ${inIds}`],
  ['employmentEvents', `contractId in (select id from employmentContracts where staffId in ${inIds})`],
  ['employmentContracts', `staffId in ${inIds}`],
  ['employmentProfiles', `staffId in ${inIds}`],
  ['staffRegistrationReviews', `requestId in (select id from staffRegistrationRequests where staffId in ${inIds})`],
  ['staffRegistrationRequests', `staffId in ${inIds}`],
  ['staffRegistrationState', `staffId in ${inIds}`],
  ['sessions', `subjectId in ${inIds}`],
  ['authChallenges', `subjectId in ${inIds}`],
  ['previewSessions', `staffId in ${inIds} or subjectId in ${inIds}`],
  ['staff', `id in ${inIds}`],
];
// Records that must not exist for these people (anything here means they are not test-only; stop).
const MUST_BE_EMPTY = [
  ['staffRates', `staffId in ${inIds}`], ['lessons', `staffId in ${inIds}`], ['staffUnavailability', `staffId in ${inIds}`],
  ['lessonRecords', `authorId in ${inIds}`], ['handoverNotes', `authorId in ${inIds} or toStaffId in ${inIds}`], ['handoverReads', `staffId in ${inIds}`],
  ['files', `staffId in ${inIds}`], ['payrollMonths', `staffId in ${inIds}`], ['payrollAdjustments', `staffId in ${inIds}`], ['meetings', `staffId in ${inIds}`],
  ['payrollWorkDays', `workDayId in (select id from workDays where staffId in ${inIds})`], ['staffBankRequests', `staffId in ${inIds} or consenterId in ${inIds}`],
  ['staffBankState', `staffId in ${inIds}`], ['employmentContracts', `staffId in ${inIds} and status = 'agreed'`],
  ['staffRegistrationRequests', `submitterId in ${inIds} and staffId not in ${inIds}`], ['staffRegistrationReviews', `reviewerId in ${inIds}`],
];
const request = JSON.parse(await readFile('release-control/scripts/test-staff-removal-request.json', 'utf8'));
const control = resolve('release-control');
const hash = b => createHash('sha256').update(b).digest('hex'), q = s => '"' + s.replaceAll('"', '""') + '"';
const same = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), msg);
let dir, stage = 'authorization';
try {
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/' + branch && process.env.GITHUB_REPOSITORY === repo, 'Use the authorized removal branch.');
  check(['inspect', 'remove', 'verify'].includes(request.operation), 'Unexpected request.');
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  check(token?.length > 20 && /^[a-f0-9]{32}$/.test(account || ''), 'Deployment credentials unavailable.');
  dir = await mkdtemp(join(tmpdir(), 'stepwise-test-staff-'));
  const prefix = request.operation === 'verify' ? request.backupPrefix : backupRoot + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
  check(new RegExp('^' + backupRoot.replaceAll('/', '\\/') + '\\d+-\\d+$').test(prefix || ''), 'Invalid private checkpoint.');
  async function cf(path, body) {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    check(r.ok && j.success === true, 'Cloudflare did not confirm success (HTTP ' + r.status + ').');
    return j.result;
  }
  async function query(sql) { const a = await cf('/d1/database/' + db + '/query', { sql }); check(Array.isArray(a) && a.every(r => r.success && Array.isArray(r.results)), 'Incomplete D1 query.'); return a; }
  const rows = async sql => (await query(sql))[0].results;
  const privacy = async () => assertPrivateBucket(await cf('/r2/buckets/' + bucket + '/domains/managed'), await cf('/r2/buckets/' + bucket + '/domains/custom'));
  async function save(name, bytes) {
    await privacy(); const f = join(dir, name), copy = join(dir, 'verify-' + name), key = bucket + '/' + prefix + '/' + name;
    await writeFile(f, bytes, { mode: 0o600 });
    runWrangler(control, ['r2', 'object', 'put', key, '--file', f, '--remote', '--config', 'cf/wrangler.jsonc']);
    runWrangler(control, ['r2', 'object', 'get', key, '--file', copy, '--remote', '--config', 'cf/wrangler.jsonc']);
    check(hash(bytes) === hash(await readFile(copy)), 'Private backup read-back mismatch.');
  }
  async function columnsNow() {
    const tables = await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name");
    const cols = {}; for (const { name } of tables) cols[name] = (await rows('PRAGMA table_info(' + q(name) + ')')).map(r => r.name); return cols;
  }
  async function snapshot(columns) {
    const names = Object.keys(columns), out = {};
    for (let i = 0; i < names.length; i += 8) {
      const batch = names.slice(i, i + 8), results = await query(batch.map(t => 'SELECT ' + columns[t].map(q).join(',') + ' FROM ' + q(t)).join(';'));
      check(results.length === batch.length, 'Incomplete record snapshot.');
      batch.forEach((t, j) => out[t] = results[j].results.map(r => JSON.stringify(columns[t].map(c => r[c]))).sort());
    }
    return out;
  }
  const triggers = async () => Object.fromEntries((await rows(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name IN (${RETAIN.map(n => `'${n}'`).join(',')}) ORDER BY name`)).map(r => [r.name, r.sql])); // sorted: recreating changes sqlite_master order

  if (request.operation === 'verify') {
    // The removal run stopped at its trigger check (key order only). Finish its checks from the private checkpoint it saved.
    stage = 'verify from checkpoint';
    await privacy();
    const f = join(dir, 'records-before.json');
    runWrangler(control, ['r2', 'object', 'get', bucket + '/' + prefix + '/records-before.json', '--file', f, '--remote', '--config', 'cf/wrangler.jsonc']);
    const saved = JSON.parse(await readFile(f, 'utf8')), cols = saved.columns, before = saved.data;
    same(Object.keys(saved.triggers).sort(), RETAIN.slice().sort(), 'Checkpoint has no trigger copy.');
    const sortedSaved = Object.fromEntries(Object.keys(saved.triggers).sort().map(k => [k, saved.triggers[k]]));
    same(await triggers(), sortedSaved, 'Retention triggers differ from before.');
    // Rows of the test teachers in the checkpoint, found by column values.
    const col = (t, c) => cols[t].indexOf(c), val = (t, r, c) => JSON.parse(r)[col(t, c)];
    const set = new Set(ids);
    const contracts = new Set(before.employmentContracts.filter(r => set.has(val('employmentContracts', r, 'staffId'))).map(r => val('employmentContracts', r, 'id')));
    const workDays = new Set(before.workDays.filter(r => set.has(val('workDays', r, 'staffId'))).map(r => val('workDays', r, 'id')));
    const requests = new Set(before.staffRegistrationRequests.filter(r => set.has(val('staffRegistrationRequests', r, 'staffId'))).map(r => val('staffRegistrationRequests', r, 'id')));
    const isDoomed = {
      workDayRevisions: r => workDays.has(val('workDayRevisions', r, 'workDayId')), workDays: r => set.has(val('workDays', r, 'staffId')),
      employmentEvents: r => contracts.has(val('employmentEvents', r, 'contractId')), employmentContracts: r => set.has(val('employmentContracts', r, 'staffId')),
      employmentProfiles: r => set.has(val('employmentProfiles', r, 'staffId')), staffRegistrationReviews: r => requests.has(val('staffRegistrationReviews', r, 'requestId')),
      staffRegistrationRequests: r => set.has(val('staffRegistrationRequests', r, 'staffId')), staffRegistrationState: r => set.has(val('staffRegistrationState', r, 'staffId')),
      sessions: r => set.has(val('sessions', r, 'subjectId')), authChallenges: r => set.has(val('authChallenges', r, 'subjectId')),
      previewSessions: r => set.has(val('previewSessions', r, 'staffId')) || set.has(val('previewSessions', r, 'subjectId')), staff: r => set.has(val('staff', r, 'id')),
    };
    const expected = {}, removed = {};
    for (const t of Object.keys(before)) { const d = isDoomed[t]; expected[t] = d ? before[t].filter(r => !d(r)) : before[t]; if (d) removed[t] = before[t].length - expected[t].length; }
    for (const [t, where] of PLAN) check((await rows(`SELECT count(*) n FROM ${q(t)} WHERE ${where}`))[0].n === 0, 'Rows remain: ' + t);
    same(await columnsNow(), cols, 'Schema changed.');
    check((await rows("SELECT count(*) n FROM auditLog WHERE action = 'testStaffRemoved'"))[0].n === 1, 'Removal not recorded once in the audit log.');
    const live = assertRecordsPreserved(cols, expected, await snapshot(cols), 'Records other than the test teachers changed. Stop for review.').activity.map(a => a.table);
    const summary = { operation: 'verify', backupPrefix: prefix, rowsRemoved: removed, retentionTriggersRestored: true, otherRecordsUnchanged: true, liveActivityTables: live, messagesSent: false };
    await save('manifest-verify.json', Buffer.from(JSON.stringify(summary)));
    console.log(JSON.stringify(summary));
    await writeFile(process.env.GITHUB_STEP_SUMMARY, '## Test teacher removal verified\n\n' + JSON.stringify(summary, null, 2) + '\n');
    await rm(dir, { recursive: true, force: true }); process.exit(0);
  }
  stage = 'read-only preflight';
  await privacy();
  const staff = await rows(`SELECT id, name, roles, testOnly FROM staff WHERE id IN ${inIds} ORDER BY id`);
  same(staff.map(s => [s.id, s.name, s.roles]), ids.slice().sort().map(i => [i, TARGETS[i], 'teacher']), 'Target teachers are not the expected test teachers.');
  check(staff.every(s => s.name.startsWith('【テスト】')), 'Only test teachers can be removed.');
  for (const [t, where] of MUST_BE_EMPTY) check((await rows(`SELECT count(*) n FROM ${q(t)} WHERE ${where}`))[0].n === 0, 'Target has records that are not test-only: ' + t);
  const savedTriggers = await triggers();
  same(Object.keys(savedTriggers).sort(), RETAIN.slice().sort(), 'Retention triggers missing before removal.');
  const columns = await columnsNow(), migrationsBefore = await rows('SELECT * FROM d1_migrations ORDER BY id');
  const doomed = {};
  for (const [t, where] of PLAN) doomed[t] = (await rows(`SELECT ${columns[t].map(q).join(',')} FROM ${q(t)} WHERE ${where}`)).map(r => JSON.stringify(columns[t].map(c => r[c])));
  const counts = Object.fromEntries(Object.entries(doomed).map(([t, r]) => [t, r.length]));
  if (request.operation === 'inspect') {
    console.log(JSON.stringify({ operation: 'inspect', teachers: staff.map(s => s.name), rowsToRemove: counts, retentionTriggers: RETAIN.length, productionWrites: false }));
  } else {
    stage = 'verified private backup';
    runWrangler(control, ['d1', 'export', 'DB2', '--remote', '--config', 'cf/wrangler.jsonc', '--output', join(dir, 'db2.sql')]);
    const sql = await readFile(join(dir, 'db2.sql')); check(sql.length > 100 && sql.includes(Buffer.from('CREATE TABLE')), 'Empty database export.');
    await save('db2.sql', sql);
    const before = await snapshot(columns);
    await save('records-before.json', Buffer.from(JSON.stringify({ columns, data: before, triggers: savedTriggers })));
    // Expected afterwards: everything as before, minus exactly the rows listed above.
    const expected = {};
    for (const t of Object.keys(before)) {
      const left = before[t].slice();
      for (const r of doomed[t] || []) { const i = left.indexOf(r); check(i >= 0, 'Snapshot changed during preflight: ' + t); left.splice(i, 1); }
      expected[t] = left;
    }
    stage = 'remove test teachers';
    const at = new Date().toISOString();
    const batch = [
      ...RETAIN.map(n => `DROP TRIGGER ${q(n)}`),
      ...PLAN.map(([t, where]) => `DELETE FROM ${q(t)} WHERE ${where}`),
      ...RETAIN.map(n => savedTriggers[n]),
      `INSERT INTO auditLog (at, actorKind, actorId, action, target, detail) VALUES ('${at}', 'system', '', 'testStaffRemoved', '${ids.join(',')}', '${JSON.stringify({ request: 'owner 2026-10-20', rows: counts }).replaceAll("'", "''")}')`,
    ].join(';\n');
    let failed = null;
    try { await query(batch); } catch (e) { failed = e; }
    // Whatever happened, put back any retention trigger that is missing, exactly as it was.
    const now = await triggers();
    for (const n of RETAIN) if (!now[n]) await query(savedTriggers[n]);
    same(await triggers(), savedTriggers, 'Retention triggers differ from before. Stop for review.');
    if (failed) throw failed;
    stage = 'verify';
    for (const [t, where] of PLAN) check((await rows(`SELECT count(*) n FROM ${q(t)} WHERE ${where}`))[0].n === 0, 'Rows remain: ' + t);
    same(await columnsNow(), columns, 'Schema changed.');
    same(await rows('SELECT * FROM d1_migrations ORDER BY id'), migrationsBefore, 'Migration history changed.');
    const live = assertRecordsPreserved(columns, expected, await snapshot(columns), 'Records other than the test teachers changed. Stop for review.').activity.map(a => a.table);
    const summary = { operation: 'remove', backupPrefix: prefix, teachers: staff.map(s => s.name), rowsRemoved: counts, retentionTriggersRestored: true, otherRecordsUnchanged: true, liveActivityTables: live, messagesSent: false };
    await save('manifest-remove.json', Buffer.from(JSON.stringify({ ...summary, dbHash: hash(sql) })));
    console.log(JSON.stringify(summary));
    await writeFile(process.env.GITHUB_STEP_SUMMARY, '## Test teachers removed\n\n' + JSON.stringify(summary, null, 2) + '\n');
  }
} catch (e) {
  const msg = e instanceof Error && !/https?:|Bearer|token=|password/i.test(e.message) ? e.message : 'Private details withheld.';
  console.error('Stopped at ' + stage + ': ' + msg); console.error('No automatic retry. Inspect the private checkpoint.'); process.exitCode = 1;
} finally { if (dir) await rm(dir, { recursive: true, force: true }); }
