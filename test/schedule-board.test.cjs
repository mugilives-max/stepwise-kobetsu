const {test}=require('node:test'),assert=require('node:assert/strict'),board=require('../assets/schedule-board.js');
const {createUI,flush}=require('./helpers/operations-ui-harness.cjs');
const date='2026-09-10',lesson=(start,min,mode='in_person',studentId='b')=>({id:start,date,start,min,deliveryMode:mode,studentId,status:'booked'});
test('capacity uses actual overlapping intervals, not the number of all intersecting lessons',()=>{
 const d={date,start:'10:00',min:120,deliveryMode:'in_person',studentId:'a'};
 assert.deepEqual(board.warnings({slots:[lesson('10:00',60),lesson('11:00',60)]},d),[]);
 assert.match(board.warnings({slots:[lesson('10:00',90),lesson('11:00',60)]},d).join(),/定員2人/);
 assert.match(board.warnings({slots:[lesson('10:00',60,'online')]},d).join(),/1対1/);
});
test('normal hours use lesson end and restriction warnings remain scoped to the selected child',()=>{
 assert.deepEqual(board.warnings({}, {date,start:'21:00',min:60}),[]);
 assert.match(board.warnings({}, {date,start:'21:30',min:60}).join(),/範囲外/);
 const data={blocked:[{date,studentId:'b'}],teacherOff:[{date,start:'11:00',end:'12:00'}]};
 assert.deepEqual(board.warnings(data,{date,start:'10:00',min:60,studentId:'a'}),[]);
 assert.match(board.warnings(data,{date,start:'10:00',min:60,studentId:'b'}).join(),/この生徒/);
});
test('board renders ordinary hours, escapes labels and explicitly surfaces off-hour lessons',()=>{
 const data={today:date,slots:[{...lesson('06:00',60),studentName:'<img>'}]};
 const normal=board.render(data,{date});assert.ok(!normal.includes('data-board-time="06:00"'));assert.match(normal,/時間外の授業が1件/);
 const full=board.render(data,{date,full:true});assert.match(full,/data-board-time="06:00"/);assert.match(full,/&lt;img&gt;/);
});
async function ready(){const ui=createUI('admin',{hash:'#lessons'});ui.requests[0].reply({admin:{today:date,students:[{id:'a',active:true,name:'【テスト】A',deliveryMode:'in_person'}],slots:[],blocked:[],teacherOff:[],wishes:[],events:[],plans:[]}});await flush();return ui;}
// 授業ページ下部の先生・生徒の授業不可フォーム2つは e285b26 で削除。

test('overlap columns remain distinct across chains, triples and adjacent lessons',()=>{
 const board=require('../assets/schedule-board.js');
 const slots=[{id:'a',start:'17:00',min:90},{id:'b',start:'17:30',min:60},{id:'c',start:'18:00',min:90},{id:'d',start:'19:30',min:60}];
 const positions=board.layout(slots);
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
  const a=slots[i],b=slots[j];if(board.minutes(a.start)<board.minutes(b.start)+b.min&&board.minutes(b.start)<board.minutes(a.start)+a.min){assert.notEqual(positions.get(a).lane,positions.get(b).lane);assert.equal(positions.get(a).count,3);}
 }
 assert.deepEqual(positions.get(slots[3]),{lane:0,count:1});
});
