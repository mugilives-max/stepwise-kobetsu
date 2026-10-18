'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {employmentWorld}=require('./helpers/employment-fixture.cjs');

test('multiple email-free drafts preserve existing records and create no invitation',async()=>{
 const {h,auth}=await employmentWorld();
 const prior=h.rows('select * from staff order by id');
 const challenges=h.rows('select * from authChallenges order by id');
 for(const name of ['乙','丙']){
  const r=await h.ok('employment/save',{auth,familyName:'【テスト】未登録',givenName:name,email:'  ',data:{weeklyHours:'週5時間'}});
  assert.equal(r.staff.email,'');assert.equal(r.staff.employmentAccess,false);
  assert.equal(r.staff.status,'invited');assert.equal(r.profile.data.weeklyHours,'週5時間');
  assert.equal(r.staff.email,''); // 招待先のメールアドレスは未登録
  assert.equal((await h.call('employment/invite',{auth,staffId:r.staff.id,confirm:true})).error.code,'needEmail');
  assert.equal((await h.call('admin/staff/reinvite',{auth,id:r.staff.id})).error.code,'needEmail');
 }
 assert.equal(h.mails().length,0);
 assert.deepEqual(h.rows('select * from authChallenges order by id'),challenges);
 for(const r of prior)assert.deepEqual(h.rows('select * from staff where id=?',r.id)[0],r);
 const n=h.rows('select count(*) n from staff')[0].n;
 assert.equal((await h.call('employment/save',{auth,familyName:'【テスト】',givenName:'不正',email:'invalid'})).error.code,'badEmail');
 assert.equal((await h.call('employment/save',{auth,familyName:'',givenName:'空欄'})).error.code,'badName');
 assert.equal((await h.call('employment/save',{auth,familyName:'【テスト】',givenName:'重複',email:'EMPLOYMENT@example.invalid'})).error.code,'duplicate');
 assert.equal(h.rows('select count(*) n from staff')[0].n,n);
});

test('owner adds email separately without changing profile or fixed contract; stale and duplicate edits fail',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w;
 const contract=await w.create('paper'),profile=(await w.get()).profile;
 const me=await h.staffWith(auth,['manager'],'manager-email@example.invalid');
 assert.equal((await h.call('employment/email',{auth:me,staffId:staff.id,version:staff.version,email:'no@example.invalid'})).error.code,'forbidden');
 for(const [email,code] of [['invalid','badEmail'],['owner@example.invalid','duplicate']]){
  assert.equal((await h.call('employment/email',{auth,staffId:staff.id,version:staff.version,email})).error.code,code);
 }
 let r=await h.ok('employment/email',{auth,staffId:staff.id,version:staff.version,email:''});
 assert.equal(r.staff.email,'');assert.deepEqual(r.profile,profile);
 assert.deepEqual(r.contracts[0],contract);
 const oldVersion=r.staff.version;
 r=await h.ok('employment/email',{auth,staffId:staff.id,version:oldVersion,email:'  DRAFT@EXAMPLE.INVALID '});
 assert.equal(r.staff.email,'draft@example.invalid');
 assert.equal((await h.call('employment/email',{auth,staffId:staff.id,version:oldVersion,email:'stale@example.invalid'})).error.code,'conflict');
 assert.deepEqual((await w.get()).profile,profile);assert.deepEqual((await w.get()).contracts[0],contract);
 const before=h.mails().length;
 assert.equal((await h.call('employment/invite',{auth,staffId:staff.id,email:r.staff.email})).error.code,'needConfirm');
 assert.equal((await h.call('employment/invite',{auth,staffId:staff.id,email:'old@example.invalid',confirm:true})).error.code,'conflict');
 assert.equal(h.mails().length,before);
 await h.ok('employment/invite',{auth,staffId:staff.id,email:r.staff.email,confirm:true});
 assert.equal(h.mails().length,before+1);assert.equal(h.mails().at(-1).to,'draft@example.invalid');
 assert.equal((await h.call('employment/email',{auth,staffId:staff.id,version:r.staff.version,email:'changed@example.invalid'})).error.code,'alreadyInvited');
 const ta=(await h.ok('staff/invite/accept',{token:h.linkFrom(h.mails().at(-1)),password:'test employment password'})).auth;
 assert.equal((await h.ok('staff/me',{auth:ta})).me.employmentAccess,false);
 assert.equal((await h.call('employment/email',{auth:ta,staffId:staff.id,version:r.staff.version,email:'self@example.invalid'})).error.code,'forbidden');
 assert.equal((await w.get()).staff.email,'draft@example.invalid');
});

test('partial unique index rejects duplicate nonempty emails and preserves all pre-migration rows',async()=>{
 const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),path=require('node:path');
 const db=new DatabaseSync(':memory:');
 db.exec("create table staff(id text primary key,email text not null,name text); create unique index staff_email on staff(email); insert into staff values('a','a@example.invalid','【テスト】旧甲'),('b','b@example.invalid','【テスト】旧乙')");
 const before=db.prepare('select * from staff order by id').all();
 db.exec(fs.readFileSync(path.join(__dirname,'../cf/migrations-v2/0029_staff_optional_email.sql'),'utf8'));
 assert.deepEqual(db.prepare('select * from staff order by id').all(),before);
 db.exec("insert into staff values('c','','【テスト】未定甲'),('d','','【テスト】未定乙')");
 assert.throws(()=>db.exec("update staff set email='a@example.invalid' where id='d'"),/UNIQUE/);
 db.close();
});
