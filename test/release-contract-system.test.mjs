import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE, assertDiff, assertPrivateBucket, assertMigrations, activeDeployment, assertPreserved, release } from '../scripts/release-contract-system.mjs';

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
