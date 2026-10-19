import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE, assertDiff, assertPrivateBucket, assertMigrations, activeDeployment, assertPreserved, release, assertRecoveredMigrations, verifyPublished, compareModule, compareRecords, assertRecordsPreserved } from '../scripts/release-contract-system.mjs';

test('only reviewed docs and bootstrap changes can follow the pinned source', () => {
  assertDiff({status:'identical', files:[]});
  assertDiff({status:'ahead', files:[{filename:'docs/FUTURE_WORK.md'}]});
  assertDiff({status:'ahead', files:[{filename:'.github/workflows/contract-release.yml'}]}, true);
  for (const path of ['cf/v2/terms.mjs', 'family/app.js', '.github/workflows/unreviewed.yml', 'package.json'])
    assert.throws(() => assertDiff({status:'ahead', files:[{filename:path}]}, true));
  assert.throws(() => assertDiff({status:'behind', files:[]}, true));
  assert.throws(() => assertDiff({status:'ahead', files:Array(300).fill({filename:'docs/a.md'})}, true));
});
test('public or unverifiable backup storage is refused', () => {
  assertPrivateBucket({enabled:false}, {domains:[]});
  assertPrivateBucket({enabled:false}, {domains:[{enabled:false}]});
  for (const [m,c] of [[{enabled:true},{domains:[]}],[{},{domains:[]}],[{enabled:false},{}],[{enabled:false},{domains:[{enabled:true}]}]])
    assert.throws(() => assertPrivateBucket(m,c));
});
test('only the expected one pending migration is accepted', () => {
  const local = ['0019_specials.sql', RELEASE.migration];
  assertMigrations(local, ['0019_specials.sql']);
  for (const applied of [[], local, ['unknown.sql'], ['0019_specials.sql','0019_specials.sql']])
    assert.throws(() => assertMigrations(local, applied));
});
test('a mixed or absent Worker deployment is refused', () => {
  assert.deepEqual(activeDeployment({deployments:[{id:'d',versions:[{percentage:100,version_id:'v'}]}]}), {deploymentId:'d',versionId:'v'});
  assert.throws(() => activeDeployment({deployments:[]}));
  assert.throws(() => activeDeployment({deployments:[{id:'d',versions:[{percentage:50,version_id:'v'}]}]}));
});
test('existing consent, file or setting differences stop publication', () => {
  const before = {consents:[['parent','v1']], files:[['original']], settings:[['termsVersion','v1']]};
  assertPreserved(before, structuredClone(before));
  for (const key of Object.keys(before)) {
    const after = structuredClone(before); after[key][0][0] = 'changed';
    assert.throws(() => assertPreserved(before, after));
  }
});
const order = ['checkSource','preflight','backup','checkUnchanged','migrate','verifyPreserved','checkWorkerUnchanged','deploy','verifyDeployment','finish'];
function fake(failure, verified=true) {
  const seen = [];
  const io = Object.fromEntries(order.map(name => [name, async () => {
    seen.push(name); if (name === failure) throw new Error('stop');
    if (name === 'backup') return {verified};
    return {};
  }]));
  return {seen, io};
}
test('backup, preservation and publication run in the required order', async () => {
  const {seen,io} = fake();
  await release(io); assert.deepEqual(seen, order);
});
test('an unverified backup can never lead to migration', async () => {
  const {seen,io} = fake(null,false);
  await assert.rejects(release(io)); assert.deepEqual(seen, order.slice(0,3));
});
for (const stage of order) test('failure at '+stage+' cannot run later stages', async () => {
  const {seen,io} = fake(stage);
  await assert.rejects(release(io));
  assert.deepEqual(seen, order.slice(0,order.indexOf(stage)+1));
});

test('verification requires the complete migration set exactly once', () => {
  const local = ['0019_specials.sql', RELEASE.migration];
  assertRecoveredMigrations(local, [...local].reverse());
  for (const applied of [[], local.slice(0,1), [...local, RELEASE.migration], [...local, 'unknown.sql']])
    assert.throws(() => assertRecoveredMigrations(local, applied));
});
const recoveryOrder = ['loadCheckpoint','verifyRecords','verifyWorker','recordVerification'];
for (const failure of [null, ...recoveryOrder]) test('recovery never calls mutation stages: '+failure, async () => {
  const seen = [];
  const io = Object.fromEntries([...recoveryOrder, 'migrate','deploy'].map(name => [name, async () => {
    seen.push(name);
    if (name === failure || name === 'migrate' || name === 'deploy') throw new Error('stop');
    return {};
  }]));
  if (failure) await assert.rejects(verifyPublished(io)); else await verifyPublished(io);
  assert.deepEqual(seen, failure ? recoveryOrder.slice(0,recoveryOrder.indexOf(failure)+1) : recoveryOrder);
});

test('module comparison ignores only the final source-map reference', () => {
  const code = Buffer.from('export default {};\n');
  assert.equal(compareModule(code,code),'exact');
  assert.equal(compareModule(code,Buffer.from(code+'//# sourceMappingURL=index.js.map\n')),'source-map-only');
  assert.equal(compareModule(code,Buffer.from('export default {changed:true};\n')),'different');
  assert.equal(compareModule(code,Buffer.from(code+'//# sourceMappingURL=index.js.map\n'),false),'different');
  assert.equal(compareModule(Buffer.from('// comment\n'+code),code),'different');
});

test('normal use of the live site does not stop a release, but changed business records do', () => {
  const row = (...v) => JSON.stringify(v);
  const columns = {families:['id','name'], sessions:['tokenHash','lastSeenAt'], effects:['id','status'], auditLog:['id','action'], authChallenges:['id','usedAt']};
  const before = {families:[row('f1','A')], sessions:[row('s1','09:00'), row('s2','09:00')],
    effects:[row(1,'pending')], auditLog:[row(1,'login')], authChallenges:[row('c1','')]};
  // Hourly lastSeenAt update, logout, new login, mail sent, new mail, new audit row, sign-in link used.
  const used = {...before, sessions:[row('s1','10:00'), row('s3','10:00')], effects:[row(1,'sent'), row(2,'pending')],
    auditLog:[row(1,'login'), row(2,'logout')], authChallenges:[row('c1','10:00'), row('c2','')]};
  const result = compareRecords(columns, before, used);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.activity.map(a => a.table), ['auditLog','authChallenges','effects','sessions']);
  assertRecordsPreserved(columns, before, structuredClone(before));
  assertRecordsPreserved(columns, before, used);
  const stops = {
    familyChanged: {families:[row('f1','B')]}, familyAdded: {families:[row('f1','A'), row('f2','C')]}, familyRemoved: {families:[]},
    effectRemoved: {effects:[]}, auditRowChanged: {auditLog:[row(1,'edited')]}, auditRowRemoved: {auditLog:[]},
    challengeRemoved: {authChallenges:[]},
  };
  const {families, ...withoutFamilies} = before;
  for (const [name, after] of [...Object.entries(stops).map(([n, c]) => [n, {...before, ...c}]), ['tableMissing', withoutFamilies]]) {
    assert.equal(compareRecords(columns, before, after).changed.length, 1, name);
    assert.throws(() => assertRecordsPreserved(columns, before, after), name);
  }
  // A volatile table without its key column is compared safely (stop), and an empty rule list makes everything strict.
  assert.equal(compareRecords({...columns, effects:['status']}, before, used).changed[0].reason, 'keyColumnMissing');
  assert.deepEqual(compareRecords(columns, before, used, {}).changed.map(c => c.table), ['auditLog','authChallenges','effects','sessions']);
  // Only table names and counts are reported, never row contents.
  assert.ok(!JSON.stringify(compareRecords(columns, before, {...before, families:[row('f1','secret')]})).includes('secret'));
});
