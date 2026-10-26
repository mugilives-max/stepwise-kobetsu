// Employment and actual work. Owner manages; each employee sees only their own data.
let cache=null, key='', dayCache=null, dayKey='', drafts=new Map(), dayEdit=''; // dayEdit: 勤務の日の画面で開いている入力欄（'plan'・'actual'）
const today=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const at=v=>v?new Date(Date.parse(v)+9*3600e3).toISOString().slice(0,16).replace('T',' '):'';
const STATUS={draft:'案・未発行',issued:'交付・同意待ち',agreed:'締結済み',withdrawn:'取り下げ'};
const WORK={lesson:'授業',prep:'準備・記録',other:'事務・見学・研修',meeting:'面談',break:'休憩'};
const formKey=f=>location.hash+'|'+f.dataset.form+'|'+(f.dataset.id||'');
export function captureEmployment(){
 document.querySelectorAll('form[data-form^="em-"],form[data-form^="wk-"]').forEach(f=>drafts.set(formKey(f),[...f.elements].filter(e=>e.name).map(e=>({name:e.name,value:e.value,checked:e.checked,type:e.type}))));
}
export function restoreEmployment(){
 if(regFocus){regFocus=false;requestAnimationFrame(()=>{const f=document.querySelector('.reg-field.has-error');if(f){f.scrollIntoView({block:'center'});[...f.querySelectorAll('input')].find(i=>i.type==='radio'||!i.value.trim())?.focus({preventScroll:true});}});}
 document.querySelectorAll('form[data-form^="em-"],form[data-form^="wk-"]').forEach(f=>{
  for(const x of drafts.get(formKey(f))||[]){
   if(x.type==='radio'){if(x.checked){const e=[...f.querySelectorAll('input[type="radio"]')].find(i=>i.name===x.name&&i.value===x.value);if(e)e.checked=true;}continue;}
   const e=f.elements.namedItem(x.name);if(e){if(x.type==='checkbox')e.checked=x.checked;else e.value=x.value;}
  }
 });
}
let regStep='input',regMode='new',regDraft=null,regErrors={},regFocus=false; // regMode: new=初めての登録 / edit=登録内容の修正
 // 本人情報の登録: 入力 → 確認 → 登録。regErrors は項目ごとの入力漏れ
export function resetEmployment(){cache=null;dayCache=null;key='';dayKey='';dayEdit='';drafts.clear();regStep='input';regMode='new';regDraft=null;regErrors={};}
function load(ctx,want,route,body,work=false){
 const set=r=>{if(work){if(dayKey!==want)return;dayCache=r;}else{if(key!==want)return;cache=r;}if(!r.ok&&!ctx.handleAuth(r))ctx.say(r.error?.message||'読み込めませんでした','error');ctx.render();};
 if(work){dayKey=want;dayCache={loading:true};}else{key=want;cache={loading:true};}
 ctx.call(route,body).then(set).catch(e=>set({ok:false,error:{message:e.message}}));
}
const check=(esc,name,label,value=false)=>'<label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="checkbox" name="'+name+'"'+(value?' checked':'')+'> '+esc(label)+'</label>';
const field=(esc,name,label,value='',type='text',required=false)=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"'+(required?' required':'')+'></label>';
const area=(esc,name,label,value='')=>'<label>'+esc(label)+'<textarea name="'+name+'" rows="3">'+esc(value)+'</textarea></label>';
const select=(esc,name,label,options,value='')=>'<label>'+esc(label)+'<select name="'+name+'">'+options.map(([k,t])=>'<option value="'+k+'"'+(k===value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>';
function attrs(r){return ' data-id="'+r.id+'" data-version="'+r.version+'" data-hash="'+r.contentHash+'"';}

const TAX_SITUATION={otherEmployer:'ほかの勤務先に出している',noneElsewhere:'ほかの勤務先には出していない',unknown:'分からない・確認中'};
const OTHER_EMPLOYMENT={yes:'ある',no:'ない'};
const REG_STATUS={pending:'確認待ち',accepted:'確認済み',returned:'修正依頼済み',superseded:'以前の登録'};
// 本人の段階（2026-10-18 本人の決めた流れ）:
//  review（雇用契約書のひな形と講師マニュアルを読み、この条件で結びたいと申し込む）→ register（契約に必要な本人情報と、契約書の受け取り方）
//  → pending（代表の確認待ち）→ prepare（代表が契約書を準備）→ contract（契約書の確認・同意）→ working（成立で正式な講師。業務画面を利用中）。
//  start は、以前の流れで成立して業務画面がまだの講師だけ。以前の登録方式の講師（registration.required が false）は review〜pending を通らない。
function stageOf(d){
 const g=d.registration||{},issued=d.contracts.some(x=>x.status==='issued'),agreed=d.contracts.some(x=>x.status==='agreed');
 if(g.required&&!g.latestId&&!d.intentAt)return 'review';
 if(g.required&&(!g.latestId||g.returned))return 'register';
 if(g.required&&g.pending)return 'pending';
 if(g.required&&!g.accepted)return 'register';
 if(agreed)return d.staff.employmentAccess?'working':'start';
 if(issued)return 'contract';
 return 'prepare';
}
const jaDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?Number(v.slice(0,4))+'年'+Number(v.slice(5,7))+'月'+Number(v.slice(8))+'日':String(v||'');
// 登録内容の一覧（左に項目名、右に内容。スマホでも折り返して読める）。nameNote は代表の確認で氏名の違いを並べて出すとき
function registrationSummary(esc,p,nameNote=''){
 return '<dl class="cond-dl" style="overflow-wrap:anywhere">'+(p.familyName?'<dt>氏名</dt><dd>'+esc(p.familyName+' '+p.givenName)+nameNote+'</dd>':'')+'<dt>現住所</dt><dd>'+esc(p.address||'未登録')+'</dd>'+(p.otherEmployment?'<dt>ほかに雇われている勤務先</dt><dd>'+esc(OTHER_EMPLOYMENT[p.otherEmployment])+(p.otherEmployment==='yes'?'<br>勤務する曜日と時間：'+esc(p.otherWorkHours):'')+'</dd>':'<dt>他の勤務先・勤務時間</dt><dd>'+esc(p.otherWork||'未登録')+'</dd>')+'<dt>扶養控除等申告書</dt><dd>'+esc(TAX_SITUATION[p.taxSituation]||'本人からの回答なし')+'</dd>'+(p.availability?'<dt>勤務希望（曜日・時間）</dt><dd>'+esc(p.availability)+'</dd>':'')+'</dl>';
}
const OTHER_TEXT=p=>p.otherEmployment?OTHER_EMPLOYMENT[p.otherEmployment]+(p.otherEmployment==='yes'&&p.otherWorkHours?'（'+p.otherWorkHours+'）':''):(p.otherWork||'未登録');
function regRows(esc,p,nameNote=''){
 const rows=[['氏名',p.familyName?p.familyName+' '+p.givenName:'',nameNote],['現住所',p.address],['ほかに雇われて働いている勤務先',OTHER_TEXT(p)],['扶養控除等申告書',TAX_SITUATION[p.taxSituation]||'未回答'],['契約書の受け取り方',p.delivery==='email'?'メールで受け取る（'+(p.recipient||'')+'）':p.delivery==='paper'?'紙で受け取る':'']].filter(([,v])=>v);
 return '<dl class="reg-rows">'+rows.map(([k,v,note])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+(note?'<small class="reg-note">'+esc(note)+'</small>':'')+'</dd></div>').join('')+'</dl>';
}
// 登録済みの内容（本人の画面）。右上の「修正する」で同じ入力 → 確認の流れへ
function registeredCard(ctx,d){
 const {esc}=ctx,g=d.registration||{requests:[]},r=g.requests.find(x=>x.id===g.latestId);if(!r)return '';
 const t=at(r.submittedAt);
 return '<section class="reg-card"><div class="reg-card-head"><h2>登録内容</h2><button type="button" class="small-btn" data-action="em-reg-edit"'+ctx.dis()+'>修正する</button></div><p class="small muted" style="margin:2px 0 0">'+esc(jaDate(t.slice(0,10))+' '+t.slice(11))+' に登録</p>'+regRows(esc,r.data)+'</section>';
}
// 今後の流れ（手続きの段階ごとに、何をするか）
const FLOW_STEPS=[['契約の内容の確認','雇用契約書のひな形と講師マニュアルを読んで申し込む'],['本人情報の登録','契約書に載せる氏名・住所と、契約書の受け取り方'],['契約書の確認・同意','同意すると契約が成立'],['勤務開始','最初の給与までに振込先を登録']];
function flowList(d){
 const i=stepIndex(d);
 return '<section class="flow"><h2>今後の流れ</h2><ol>'+FLOW_STEPS.map(([t,b],k)=>'<li class="'+(k<i?'done':k===i?'now':'')+'"><div class="ft">'+t+(k<i?'<span class="fbadge">完了</span>':k===i?'<span class="fbadge now">いまここ</span>':'')+'</div><div class="fb">'+b+'</div></li>').join('')+'</ol></section>';
}
// 本人の登録フォーム。氏名は代表が招待時に入れた表示名を写さず、本人に入力してもらう（再登録のときは前回の入力を出す）
const splitAddress=v=>{const m=String(v||'').match(/^〒\s*(\d{3}-?\d{4})\s*([\s\S]*)$/);return m?{zip:m[1],addr:m[2]}:{zip:'',addr:String(v||'')};};
function registrationForm(ctx,g,r){
 const {esc}=ctx,p=regDraft||r?.data||{},{zip,addr}=splitAddress(p.address);
 const req='<span class="req">必須</span>',E=regErrors;
 const err=(...k)=>k.map(x=>E[x]).filter(Boolean).map(m=>'<p class="reg-error" role="alert">'+esc(m)+'</p>').join(''),cls=(...k)=>'reg-field'+(k.some(x=>E[x])?' has-error':'');
 const text=(name,label,value,attrs)=>'<label class="sub">'+esc(label)+'<input name="'+name+'" value="'+esc(value||'')+'" '+attrs+'></label>';
 const radio=(name,opts,value)=>'<div class="choices">'+opts.map(([v,t,sub])=>'<label class="choice"><input type="radio" name="'+name+'" value="'+v+'" required'+(value===v?' checked':'')+'><span>'+esc(t)+(sub?'<small>'+esc(sub)+'</small>':'')+'</span></label>').join('')+'</div>';
 return '<form class="reg-form" data-form="em-registration" data-version="'+g.version+'" novalidate>'+
  '<fieldset class="'+cls('name')+'"><legend>氏名 '+req+'</legend><div class="row" style="flex-wrap:nowrap;gap:10px">'+
   text('familyName','姓',p.familyName,'required autocomplete="family-name" placeholder="例：山田" style="min-width:0"').replace('<label class="sub">','<label class="sub" style="flex:1 1 0;min-width:0">')+
   text('givenName','名',p.givenName,'required autocomplete="given-name" placeholder="例：太郎" style="min-width:0"').replace('<label class="sub">','<label class="sub" style="flex:1 1 0;min-width:0">')+
  '</div>'+err('name')+'</fieldset>'+
  '<fieldset class="'+cls('zip','addr')+'"><legend>現住所 '+req+'</legend>'+
   text('zip','郵便番号',zip,'required inputmode="numeric" autocomplete="postal-code" pattern="\\d{3}-?\\d{4}" maxlength="8" placeholder="例：343-0002" style="max-width:11em"')+
   text('addr','住所（都道府県から建物名・部屋番号まで）',addr,'required autocomplete="street-address" maxlength="480" placeholder="例：埼玉県越谷市袋山1-2-3 ○○ハイツ101"')+err('zip','addr')+
  '</fieldset>'+
  '<fieldset class="'+cls('otherEmployment','otherWorkHours')+'"><legend>ほかに雇われて働いている勤務先 '+req+'</legend><p class="reg-help">アルバイト・パートを含みます。業務委託や自営は含めません。</p>'+
   radio('otherEmployment',[['no','ない'],['yes','ある']],p.otherEmployment)+err('otherEmployment')+
   '<div class="ow-hours">'+text('otherWorkHours','その勤務先で働く曜日と時間（おおよそ）',p.otherWorkHours,'maxlength="1000" placeholder="例：月・水 17時〜21時"')+err('otherWorkHours')+'</div>'+
  '</fieldset>'+
  '<fieldset class="'+cls('taxSituation')+'"><legend>扶養控除等申告書 '+req+'</legend>'+
   radio('taxSituation',[['noneElsewhere','ほかの勤務先には出していない'],['otherEmployer','ほかの勤務先に出している'],['unknown','分からない・確認中']],p.taxSituation)+err('taxSituation')+
  '</fieldset>'+
  '<fieldset class="'+cls('delivery','recipient')+'"><legend>契約書の受け取り方 '+req+'</legend>'+
   radio('delivery',[['email','メールで受け取る','この画面で同意します'],['paper','紙で受け取る','印刷した契約書に署名します']],p.delivery)+err('delivery')+
   '<div class="dl-mail">'+text('recipient','受け取るメールアドレス',p.recipient||cache?.staff?.email||'','type="email" maxlength="200" autocomplete="email"')+err('recipient')+'</div>'+
  '</fieldset>'+
  (p.availability?'<input type="hidden" name="availability" value="'+esc(p.availability)+'">':'')+
  '<button class="primary wide"'+ctx.dis()+'>入力内容を確認する</button></form>';
}
// 確認画面: 入力した内容を一覧で見せ、「この内容で登録する」で初めて送る。登録し直しのときだけ、契約書の発行が止まることを書く
function registrationConfirm(ctx,g,again){
 const {esc}=ctx;
 return '<section class="reg-confirm"><h2>入力内容の確認</h2><div class="reg-card">'+regRows(esc,regDraft)+'</div>'+
  '<form class="stack" data-form="em-registration-confirm" data-version="'+g.version+'"><button class="primary wide"'+ctx.dis()+'>この内容で登録する</button><button type="button" class="wide" data-action="em-reg-back"'+ctx.dis()+'>入力画面に戻って直す</button>'+(again?'<p class="small muted" style="margin:0">登録し直すと、確認が終わるまで契約書の発行は止まります。</p>':'')+'</form></section>';
}
function personalInfo(ctx,d,owner){
 const {esc}=ctx,g=d.registration||{requests:[],version:0},r=g.requests.find(x=>x.id===g.latestId);
 const p=r?.data||d.profile?.data||{};
 let h='<section id="personal-info"><h2>本人情報</h2>';
 if(owner){
  if(!r)return '';
  const t=at(r.submittedAt);
  return '<section class="reg-card"><div class="reg-card-head"><h2>本人の登録内容</h2><span class="small muted">'+esc(REG_STATUS[r.status])+'</span></div><p class="small muted" style="margin:2px 0 0">'+esc(jaDate(t.slice(0,10))+' '+t.slice(11))+' に登録</p>'+regRows(esc,p)+(r.reason&&r.status==='returned'?'<p class="notice" style="margin-bottom:0">本人に伝えた修正のお願い：'+esc(r.reason)+'</p>':'')+'</section>'+
   (g.requests.length>1?'<details><summary>これまでの登録（'+g.requests.length+'件）</summary><ul>'+g.requests.map(x=>'<li>'+esc(at(x.submittedAt))+'：'+esc(REG_STATUS[x.status])+(x.reason?'（'+esc(x.reason)+'）':'')+'</li>').join('')+'</ul></details>':'');
 }
 if(r)h+=registrationSummary(esc,p);
 if(r?.reason&&r.status==='returned')h+='<p class="notice">修正してほしい内容：'+esc(r.reason)+'</p>';
 if(owner&&r?.status==='pending'){
  const data=' data-version="'+g.version+'" data-request="'+esc(r.id)+'" data-hash="'+esc(r.contentHash)+'" data-profile-version="'+(d.profile?.version||0)+'"';
  h+='<form class="stack" data-form="em-registration-accept"'+data+'>'+
   (r.nameDiffers?'<fieldset style="min-width:0;border:1px solid #d5dce1;border-radius:8px;padding:12px"><legend>氏名の扱い</legend><label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="radio" name="nameDecision" value="apply" required> 本人の入力「'+esc(r.submittedName)+'」を表示名に反映する</label><label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="radio" name="nameDecision" value="keep" required> 今の表示名「'+esc(d.staff.name)+'」のままにする（本人と確認してから直す）</label><p class="small muted">発行済みの契約書・同意の記録・ログインのメールアドレスは変わりません。これから作る契約書には反映後の氏名が載ります。</p></fieldset>':'')+
   '<p class="small">現住所・ほかの勤務先の申告を雇用情報に反映します。申告書の正式な提出状況と給与区分は、勤務条件の欄で別途確認します。発行済みの契約書は変わりません。</p><button class="primary"'+ctx.dis()+'>本人情報を確認して反映する</button></form><details><summary>修正を依頼する</summary><form class="stack" data-form="em-registration-return"'+data+'>'+area(esc,'reason','修正してほしい内容')+'<button'+ctx.dis()+'>修正を依頼する</button></form></details>';
 }
 if(owner&&g.requests.length>1)h+='<details><summary>本人情報の登録履歴</summary><ul>'+g.requests.map(x=>'<li>'+esc(at(x.submittedAt))+'：'+esc(REG_STATUS[x.status])+(x.reason?'（'+esc(x.reason)+'）':'')+'</li>').join('')+'</ul></details>';
 return h+'</section>';
}
function ownerReview(ctx,d){
 const {esc}=ctx,g=d.registration,r=g.requests.find(x=>x.id===g.latestId),p=r.data,t=at(r.submittedAt);
 const data=' data-version="'+g.version+'" data-request="'+esc(r.id)+'" data-hash="'+esc(r.contentHash)+'" data-profile-version="'+(d.profile?.version||0)+'"';
 let h='<section class="reg-card"><div class="reg-card-head"><h2>本人が登録した内容</h2></div><p class="small muted" style="margin:2px 0 0">'+esc(jaDate(t.slice(0,10))+' '+t.slice(11))+' に登録</p>'+regRows(esc,p,r.nameDiffers?'招待のときの表示名：'+d.staff.name:'')+'</section>';
 h+='<form class="reg-form" data-form="em-registration-accept"'+data+'>';
 if(r.nameDiffers)h+='<fieldset class="reg-field"><legend>表示名をどうしますか</legend><div class="choices">'+
  '<label class="choice"><input type="radio" name="nameDecision" value="apply" required><span>「'+esc(r.submittedName)+'」に変える<small>これから作る契約書にも、この氏名が載ります。</small></span></label>'+
  '<label class="choice"><input type="radio" name="nameDecision" value="keep" required><span>「'+esc(d.staff.name)+'」のままにする</span></label></div></fieldset>';
 h+='<button class="primary wide"'+ctx.dis()+'>この内容で受け付ける</button></form>';
 h+='<details style="margin-top:14px"><summary>修正をお願いする</summary><form class="stack" data-form="em-registration-return"'+data+'>'+area(esc,'reason','直してほしいところ（本人の画面に表示されます）')+'<button'+ctx.dis()+'>修正をお願いする</button></form></details>';
 if(g.requests.length>1)h+='<details><summary>これまでの登録（'+g.requests.length+'件）</summary><ul>'+g.requests.map(x=>'<li>'+esc(at(x.submittedAt))+'：'+esc(REG_STATUS[x.status])+(x.reason?'（'+esc(x.reason)+'）':'')+'</li>').join('')+'</ul></details>';
 return h;
}
function invitation(ctx,d){
 if(d.staff.status!=='invited')return '';
 const {esc}=ctx;let h='<section><h2>本人を招待する</h2>';
 if(!d.profile?.invitedAt)h+='<form class="stack" data-form="em-email" data-version="'+d.staff.version+'">'+field(esc,'email','本人のメールアドレス',d.staff.email||'','email')+'<button'+ctx.dis()+'>メールアドレスを保存</button></form>';
 if(d.staff.email)h+='<form class="stack" data-form="em-invite"><input type="hidden" name="email" value="'+esc(d.staff.email)+'">'+check(esc,'confirm',d.staff.email+' へ招待メールを送る。再送時は前のリンクが無効になります。')+'<button class="primary"'+ctx.dis()+'>招待メールを送る</button></form>';
 if(d.inviteDelivery)h+='<p class="small">招待の送信状況：'+esc({pending:'送信待ち',sent:'送信済み',failed:'確認が必要',dismissed:'送信なし'}[d.inviteDelivery.status]||d.inviteDelivery.status)+' '+esc(d.inviteDelivery.error||'')+'</p>';
 return h+'</section>';
}
// 画面の先頭: 今すること（または待っていること）を 1 つだけ。文は、エラーの直し方・締め切り・取り消せないことだけ
function nextStep(ctx,d,owner){
 const g=d.registration||{},issued=d.contracts.find(x=>x.status==='issued'),agreed=d.contracts.some(x=>x.status==='agreed');
 let title,body='';
 if(owner){
  if(d.staff.status==='invited')title=d.profile?.invitedAt?'本人のアカウント設定待ち':'まず招待メールを送ってください';
  else if(g.pending)title='登録内容を確認してください';
  else if(g.required&&!g.latestId&&!d.intentAt)title='本人が契約の内容を確認しています';
  else if(g.required&&(!g.accepted||g.returned))title=g.returned?'本人の登録し直し待ち':'本人情報の登録待ち';
  else {
   const draft=d.contracts.find(x=>x.status==='draft'),el=issued?.method==='electronic';
   const auto=issued&&el&&issued.autoMail&&!issued.deliveredAt,autoFail=auto&&['failed','unknown'].includes(issued.autoMail.deliveryState||'')&&issued.autoMail.status!=='sent';
   if(autoFail){title='契約書のメールが送れなかった可能性があります';body='PDF を手で送って記録してください。';}
   else if(auto)title='契約書を送っています';
   else if(issued&&el&&!issued.preferenceAt)title='本人の受け取り方法を待っています';
   else if(issued&&!issued.deliveredAt)title=el?'契約書を本人に送ってください':'契約書を印刷して本人に渡してください';
   else if(issued&&el)title='本人の同意を待っています';
   else if(issued)title='署名を記録してください';
   else if(draft)title='契約書の案を確かめて発行してください';
   else if(!agreed)title='契約書の案を作ってください';
   else if(!d.staff.employmentAccess)title='業務画面を使えるようにしてください';
   else if(d.checks.length)title='最初の給与までに済ませてください';
   else return '';
  }
 }else{
  const stage=stageOf(d);
  if(stage==='review')title='雇用契約の内容を確認してください';
  else if(stage==='register')title=g.returned?'本人情報を直して登録し直してください':'まず本人情報を登録してください';
  else if(stage==='pending')title='登録内容を確認しています';
  else if(stage==='contract'&&issued.method==='paper'){title=issued.deliveredAt?'契約書に署名してください':'契約書を紙でお渡しします';if(issued.deliveredAt)body='署名すると契約が成立します。';}
  else if(stage==='contract')title=issued.deliveredAt?'届いた契約書を確認してください':issued.preferenceAt?'契約書の交付待ちです':'契約書と受け取り方法を確認してください';
  else if(stage==='prepare')title='契約書を準備しています';
  else if(!d.bank?.accepted)title=d.bank?.pending?'振込先を確認しています':'最初の給与までに振込先を登録してください';
  else if(stage==='working')return '';
  else if(stage==='start'&&!d.rulesReadAt)title='講師マニュアルを読んでください';
  else {const plan=d.days?.find(x=>x.planVersion&&x.planVersion!==x.planAgreedVersion);title=plan?'勤務予定を確認してください':d.staff.employmentAccess?'入職の準備が整っています':'初日の勤務予定を準備しています';}
 }
 return '<section class="notice" style="overflow-wrap:anywhere"><h2 style="margin:0">'+ctx.esc(title)+'</h2>'+(body?'<p>'+ctx.esc(body)+'</p>':'')+'</section>';
}
const STEPS=['契約の内容','本人情報','契約書','勤務開始'];
function stepIndex(d){const s=stageOf(d);return s==='review'?0:s==='register'||s==='pending'?1:s==='prepare'||s==='contract'?2:s==='start'?3:4;}
function stepper(d){
 const i=stepIndex(d);if(i>3)return '';
 return '<ol class="steps" aria-label="入職の手続きの進み具合">'+STEPS.map((t,k)=>'<li class="'+(k<i?'done':k===i?'now':'')+'"'+(k===i?' aria-current="step"':'')+'><span class="n">'+(k<i?'✓':k+1)+'</span><span class="t">'+t+'</span></li>').join('')+'</ol>';
}

function profile(ctx,d,owner){
 const {esc}=ctx,p=d.profile?.data||{};
 if(!owner)return '<details><summary>自分の雇用情報</summary><p>'+esc(d.staff.name)+'<br>'+esc(p.startDate||'未登録')+'〜'+esc(p.endDate||'未登録')+'<br>'+(p.availability?'勤務希望：'+esc(p.availability):'')+'</p></details>';
 return '';
}
const today2=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const card=(title,help,body)=>'<section class="reg-card"><div class="reg-card-head"><h2>'+title+'</h2></div>'+(help?'<p class="reg-help" style="margin-top:2px">'+help+'</p>':'')+body+'</section>';
const fset=(legend,body,help='')=>'<fieldset class="reg-field"><legend>'+legend+'</legend>'+body+(help?'<p class="reg-help">'+help+'</p>':'')+'</fieldset>';
const formAttrs=(name,d)=>' class="reg-form" style="margin-top:10px" data-form="'+name+'" data-staff="'+d.staff.id+'" data-version="'+(d.profile?.version||0)+'"';
// 契約書に載る内容: 本人の情報を確かめ、契約期間などを入れて、そのまま案を作る（契約書の準備の段階はこれだけ）
const rows=(esc,list)=>'<dl class="reg-rows">'+list.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';
const METHOD={electronic:'電子（本人がこの画面で同意）',paper:'紙（印刷して双方が署名）'};
const WEEKJ='日月火水木金土';
const dayW=v=>jaDate(v)+'（'+WEEKJ[new Date(v+'T00:00:00Z').getUTCDay()]+'）';
const monthEnd=start=>{const [y,m,dd]=start.split('-').map(Number);const t=new Date(Date.UTC(y,m,dd));t.setUTCDate(t.getUTCDate()-1);return t.toISOString().slice(0,10);};
const plannedOf=x=>{try{return JSON.parse(x.planned||'[]');}catch{return [];}};
const timesOf=x=>{const out=[];for(const i of plannedOf(x).sort((a,b)=>a.start<b.start?-1:1)){const l=out.at(-1);if(l&&l.end>=i.start){if(i.end>l.end)l.end=i.end;}else out.push({start:i.start,end:i.end});}return out.map(i=>i.start+'〜'+i.end).join('、');};
// 契約書の時給（締結済みの版があればそれ、なければ入れた時給、どちらもなければ 2,000円）
const hourlyOf=d=>Number(d.contracts?.find(x=>x.status==='agreed')?.snapshot?.lessonHourly||d.profile?.data?.hourly||2000);
// 最初の1か月のシフト（契約書の末尾に載る）。勤務の日は勤務の画面で入れる
function firstShifts(ctx,d){
 const {esc}=ctx,p=d.profile?.data||{},start=p.startDate||'',end=start?monthEnd(start):'';
 const days=(d.days||[]).filter(x=>x.planVersion&&plannedOf(x).length&&(!start||(x.date>=start&&x.date<=end))).sort((a,b)=>a.date<b.date?-1:1);
 return '<div class="sec-title">最初の1か月のシフト <span class="req">必須</span></div>'+(start?'<p class="reg-help" style="margin:0 0 6px">'+esc(jaDate(start)+'〜'+jaDate(end))+'</p>':'')+
  (days.length?'<div class="group">'+days.map(x=>'<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'"><span class="v"><span class="lbl">'+esc(dayW(x.date))+'</span><small>'+esc(timesOf(x))+'</small></span><span class="go" aria-hidden="true">›</span></a>').join('')+'</div>':'<p class="reg-help" style="margin:0">まだ入っていません。</p>')+
  '<form class="row" style="gap:8px;margin-top:8px;flex-wrap:nowrap" data-form="wk-open"><input type="date" name="date" required value="'+esc(start||today())+'" style="flex:1 1 0;min-width:0"><button style="white-space:nowrap"'+ctx.dis()+'>この日の予定を入れる</button></form>';
}
function ownerDraftForm(ctx,d,{again=false}={}){
 const {esc}=ctx,p=d.profile?.data||{},legacy=!d.registration?.required,req=' <span class="req">必須</span>';
 const radio=(v,t)=>'<label class="choice"><input type="radio" name="method" value="'+v+'" required'+(p.deliveryMethod===v?' checked':'')+'><span>'+esc(t)+'</span></label>';
 const wish=p.deliveryMethod==='electronic'?'本人の希望：メールで受け取る（'+(p.deliveryRecipient||'')+'）':p.deliveryMethod==='paper'?'本人の希望：紙で受け取る':'';
 const ins=(v,t,sub)=>'<label class="choice"><input type="radio" name="employmentInsurance" value="'+v+'" required'+(p.employmentInsurance===v?' checked':'')+'><span>'+esc(t)+'<small>'+esc(sub)+'</small></span></label>';
 const who=legacy?'':'<div class="sec-title" style="margin-top:6px">本人の情報</div>'+rows(esc,[['氏名',d.staff.name],['住所',p.address||'未登録'],['ほかに雇われて働いている勤務先',p.otherWork||'未登録']]);
 return card(again?'新しい契約書の案':'契約書に載る内容','',who+firstShifts(ctx,d)+'<div class="sec-title">契約の条件</div>'+
  '<form'+formAttrs('em-draft',d)+'>'+
  (legacy?fset('住所'+req,'<input name="address" required maxlength="500" value="'+esc(p.address||'')+'">')+fset('ほかに雇われて働いている勤務先'+req,'<textarea name="otherWork" required rows="2" maxlength="1500">'+esc(p.otherWork||'')+'</textarea>','ない場合は「なし」と入れます。'):'')+
  fset('契約期間'+req,'<div class="row" style="flex-wrap:nowrap;gap:10px"><label class="sub" style="flex:1 1 0;min-width:0">開始日<input type="date" name="startDate" required value="'+esc(p.startDate||'')+'"></label><label class="sub" style="flex:1 1 0;min-width:0">終了日<input type="date" name="endDate" required value="'+esc(p.endDate||'')+'"></label></div>')+
  fset('勤務時間の目安'+req,'<input name="weeklyHours" required maxlength="500" value="'+esc(p.weeklyHours||'週5〜6時間ほど。')+'">')+
  fset('時給'+req,'<div class="row" style="gap:8px;align-items:center;flex-wrap:nowrap"><input type="number" name="hourly" required min="100" max="99999" step="1" inputmode="numeric" style="max-width:9em" value="'+esc(p.hourly||'2000')+'"><span>円</span></div>')+
  fset('雇用保険'+req,'<div class="choices">'+ins('no','加入しない','週20時間未満の勤務、または昼間の学生')+ins('yes','加入する','週20時間以上で、31日以上続けて働く見込み')+'</div>')+
  fset('締結の方法'+req,'<div class="choices">'+radio('electronic',METHOD.electronic)+radio('paper',METHOD.paper)+'</div>',esc(wish))+
  '<button class="primary wide"'+ctx.dis()+'>この内容で契約書の案を作る</button></form>');
}
// 発行前・交付前の契約書: 何が済んで、次に何をするかを順に出す
function ownerContract(ctx,d,r){
 const {esc}=ctx,a=attrs(r),s=r.snapshot,el=r.method==='electronic',draft=r.status==='draft';
 const head='<div class="reg-card-head"><h2>'+(draft?'契約書の案':'契約書')+'（第'+r.revision+'版）</h2><span class="small muted">'+esc(STATUS[r.status])+'</span></div>';
 let h=rows(esc,[['締結の方法',METHOD[r.method]],['契約期間',jaDate(s.startDate)+'〜'+jaDate(s.endDate)]])+'<button type="button" class="wide" data-action="em-doc"'+a+'>全文を開く・PDFで保存</button>';
 const step=(state,title,body='')=>'<li class="'+state+'"><div class="ft">'+esc(title)+(state==='done'?'<span class="fbadge">済み</span>':'')+'</div>'+(body?'<div class="fb">'+body+'</div>':'')+'</li>';
 if(draft)h+='<form class="reg-form" style="margin-top:14px" data-form="em-issue"'+a+'><label class="choice"><input type="checkbox" name="agree" required><span>全文を確かめました。この内容で契約します</span></label><div class="stack"><button class="primary wide"'+ctx.dis()+'>発行する</button><p class="reg-help" style="margin:0">発行すると、本人の画面にこの契約書が出ます。'+(el&&d.profile?.data?.deliveryMethod==='electronic'?esc(d.profile.data.deliveryRecipient||'')+' へ全文を自動で送ります。':'')+'</p></div></form>';
 else {
  const now=new Date(Date.now()+9*3600e3).toISOString().slice(0,16);
  const deliver=(label,note,check,button)=>'<form class="reg-form" style="margin-top:8px" data-form="em-delivery"'+a+'>'+fset(label,'<input type="datetime-local" name="deliveredAt" required value="'+now+'">')+fset('方法・宛先','<input name="note" required maxlength="500" value="'+esc(r.deliveryNote||note)+'">')+'<label class="choice"><input type="checkbox" name="delivered" required><span>'+esc(check)+'</span></label><button class="primary wide"'+ctx.dis()+'>'+esc(button)+'</button></form>';
  let li=step('done','発行','<span>'+esc(at(r.issuedAt))+'</span>');
  if(el&&r.autoMail){ // 本人が本人情報の登録でメールでの受け取りを希望 → 発行のときにシステムが送る
   const m=r.autoMail,failed=!r.deliveredAt&&['failed','unknown'].includes(m.deliveryState||'')&&m.status!=='sent';
   li+=step('done','受け取り先（本人の希望）',esc(r.recipient)+'（'+esc(at(r.preferenceAt))+'）');
   li+=step(r.deliveredAt?'done':'now','本人に送る',r.deliveredAt?esc(at(r.deliveredAt))+' システムのメールで送付':failed?'<span style="color:var(--danger)">送れなかった可能性があります'+(m.error?'（'+esc(m.error)+'）':'')+'。</span>「全文を開く・PDFで保存」で保存した PDF を手で送ってから記録してください。'+deliver('送った日時','PDFをメールに添付して '+r.recipient+' へ送付','この版の契約書の全文を送った','送ったことを記録する'):'送っています');
   li+=step(r.deliveredAt?'now':'','本人の同意','本人がこの画面で同意すると成立します。');
  }else if(el){
   li+=step(r.preferenceAt?'done':'now','本人が受け取り先を伝える',r.preferenceAt?esc(r.recipient)+'（'+esc(at(r.preferenceAt))+'）':'');
   li+=step(r.deliveredAt?'done':r.preferenceAt?'now':'','本人に送る',r.deliveredAt?esc(at(r.deliveredAt))+' '+esc(r.deliveryNote||''):r.preferenceAt?deliver('送った日時','PDFをメールに添付して '+r.recipient+' へ送付','この版の契約書の全文を送った','送ったことを記録する'):'');
   li+=step(r.deliveredAt?'now':'','本人の同意','本人がこの画面で同意すると成立します。');
  }else{
   li+=step(r.deliveredAt?'done':'now','印刷して本人に渡す',r.deliveredAt?esc(at(r.deliveredAt))+' '+esc(r.deliveryNote||''):deliver('渡した日時','手渡し','この版の契約書の全文を渡した','渡したことを記録する'));
   li+=step(r.deliveredAt?'now':'','双方の署名',r.deliveredAt?'<form class="reg-form" style="margin-top:8px" data-form="em-paper"'+a+'>'+fset('署名した日時','<input type="datetime-local" name="agreedAt" required value="'+now+'">')+fset('署名した講師の氏名','<input name="consenterName" required value="'+esc(s.staffName)+'">')+fset('署名済みの控えの保管先','<input name="evidenceRef" required maxlength="500" placeholder="例：Google ドライブの雇用契約フォルダ">')+'<label class="choice"><input type="checkbox" name="signed" required><span>双方が署名し、双方に控えを渡した</span></label><button class="primary wide"'+ctx.dis()+'>締結を記録する</button></form>':'');
  }
  h+='<div class="flow" style="margin:16px 0 4px"><ol>'+li+'</ol></div>';
 }
 h+='<details style="margin-top:6px"><summary>'+(draft?'案を取り下げて作り直す':'発行を取り下げて作り直す')+'</summary><form class="stack" data-form="em-withdraw"'+a+'>'+field(esc,'reason','取り下げる理由','','text',true)+'<button'+ctx.dis()+'>取り下げる</button></form></details>';
 return '<section class="reg-card">'+head+h+'</section>';
}
// これまでの記録（登録内容・登録の履歴・取り下げた案・交付と同意の履歴）。ふだんは閉じておく
function ownerRecords(ctx,d){
 const {esc}=ctx,g=d.registration||{requests:[]},r=g.requests.find(x=>x.id===g.acceptedId),old=d.contracts.filter(x=>x.status==='withdrawn');
 let x='';
 if(r)x+='<div class="sec-title">本人の登録内容</div><div class="reg-card" style="margin:0">'+regRows(esc,r.data)+'</div>';
 if(g.requests.length>1)x+='<div class="sec-title">本人情報の登録</div><ul>'+g.requests.map(q=>'<li>'+esc(at(q.submittedAt))+'：'+esc(REG_STATUS[q.status])+(q.reason?'（'+esc(q.reason)+'）':'')+'</li>').join('')+'</ul>';
 if(old.length)x+='<div class="sec-title">取り下げた契約書</div>'+old.map(c=>contractCard(ctx,c,true)).join('');
 if(d.events?.length)x+='<div class="sec-title">契約書の交付・同意</div><ul>'+d.events.map(e=>'<li>'+esc(e.action)+'：'+esc(at(e.actualAt))+'／記録 '+esc(at(e.recordedAt))+' '+esc(e.actorName)+'</li>').join('')+'</ul>';
 return x?'<details style="margin-top:24px"><summary>これまでの記録</summary>'+x+'</details>':'';
}
// 2. 給与の設定（源泉徴収の区分と時給。契約書には載らない）
function ownerPay(ctx,d){
 const {esc}=ctx,p=d.profile?.data||{},g=d.registration||{requests:[]},reg=g.requests.find(x=>x.id===g.acceptedId)?.data;
 const pending=d.checks.filter(x=>x.startsWith('給与の設定'));
 const radio=(v,t,sub)=>'<label class="choice"><input type="radio" name="taxDeclaration" value="'+v+'" required'+(p.taxDeclaration===v?' checked':'')+'><span>'+t+(sub?'<small>'+sub+'</small>':'')+'</span></label>';
 return card('給与の設定'+(pending.length?'':' <span class="tag ok">設定済み</span>'),pending.length?'最初の給与の前に済ませてください。':'',
  '<form'+formAttrs('em-pay',d)+'>'+
  fset('扶養控除等申告書','<div class="choices">'+radio('submitted','塾に出す（甲欄）','ほかの勤務先に出していない人')+radio('notSubmitted','塾には出さない（乙欄）','ほかの勤務先に出している人など')+'</div>',reg?.taxSituation?'本人の回答：'+esc({otherEmployer:'ほかの勤務先に出している',noneElsewhere:'ほかの勤務先には出していない',unknown:'分からない・確認中'}[reg.taxSituation]||''):'')+
  fset('扶養人数（甲欄のとき）','<input type="number" name="dependents" min="0" max="7" style="max-width:8em" value="'+esc(p.dependents||'')+'">','甲欄のときは 0 人でも入れてください。')+
  fset('確認した日','<input type="date" name="taxCheckedOn" required style="max-width:12em" value="'+esc(p.taxCheckedOn||today2())+'">')+
  '<p class="reg-help" style="margin:0">時給 '+hourlyOf(d).toLocaleString('ja-JP')+'円　<a href="#rates">時給・源泉徴収の履歴</a></p>'+
  '<button class="primary wide"'+ctx.dis()+'>給与の設定を保存</button></form>');
}
// 3. シフトのメモ（予定を組むときの参考。契約書には載らない）
function ownerShift(ctx,d){
 const {esc}=ctx,p=d.profile?.data||{};
 return card('シフトのメモ','',
  '<form'+formAttrs('em-shift',d)+'><textarea name="availability" rows="3" maxlength="500" placeholder="例：土曜は15時まで、日曜は終日。金曜は不可">'+esc(p.availability||'')+'</textarea><button'+ctx.dis()+'>メモを保存</button></form>');
}
// 4. 勤務開始までにすること（代表のやることリスト。残りがなくなったら業務画面を使えるようにする）
function ownerTodo(ctx,d){
 const {esc}=ctx,p=d.profile?.data||{},legacy=!d.registration?.required;
 const list=d.checks.length?'<ul class="todo-list">'+d.checks.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p><strong>すべて済んでいます。</strong></p>';
 const box=(name,label,on)=>'<label class="choice"><input type="checkbox" name="'+name+'"'+(on?' checked':'')+'><span>'+label+'</span></label>';
 const agreed=d.contracts.some(x=>x.status==='agreed');
 return card('最初の給与までにすること','',
  list+'<form'+formAttrs('em-todo',d)+'>'+
  ('<div class="choices">'+box('insuranceChecked','労働保険（労災保険など）の届出・確認を済ませた',p.insuranceChecked)+(legacy?box('bankConsentChecked','振込先と振込への同意を、紙などで受け取って確認した',p.bankConsentChecked):'')+'</div>')+
  fset('メモ（代表だけが見ます）','<textarea name="preparationNote" rows="3" maxlength="500">'+esc(p.preparationNote||'')+'</textarea>'+(p.insuranceNote?'<p class="reg-help">以前のメモ：'+esc(p.insuranceNote)+'</p>':''))+
  '<button'+ctx.dis()+'>保存</button></form>'+
  (agreed&&!d.staff.employmentAccess?'<button class="primary wide" style="margin-top:10px" data-action="em-activate"'+ctx.dis()+'>業務画面を使えるようにする</button>':''));
}
function contractCard(ctx,r,owner){
 const {esc}=ctx,a=attrs(r),s=r.snapshot;
 let h='<details class="sheet"'+(r.status==='issued'?' open':'')+'><summary>第'+r.revision+'版（'+(r.method==='paper'?'紙':'電子')+'）・'+STATUS[r.status]+'</summary><p>'+esc(jaDate(s.startDate))+'〜'+esc(jaDate(s.endDate))+'</p><button type="button" data-action="em-doc"'+a+'>全文を開く・PDF保存</button><details><summary>この版の本文を確認</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">'+esc(s.text)+'</pre></details>';
 if(owner&&r.status==='draft')h+='<form class="stack" data-form="em-issue"'+a+'>'+check(esc,'agree','この版の全文を確認し、代表としてこの条件での契約に合意して発行する')+'<button'+ctx.dis()+'>この版を発行する</button></form>';
 if(r.status==='issued'&&owner) {
  h+='<p class="small">発行した書面全体を交付してから、実際の交付を記録してください。画面に置いたことだけで交付済みにはしません。</p>';
  if(r.method==='electronic')h+='<p>電子交付の希望：'+(r.preferenceAt?esc(r.recipient)+'（'+esc(at(r.preferenceAt))+'）':'本人の確認待ち')+'</p>';
  if(r.method==='paper'||r.preferenceAt)h+='<form class="stack" data-form="em-delivery"'+a+'>'+field(esc,'deliveredAt','実際に交付した日時','','datetime-local',true)+area(esc,'note','交付方法・送付先・確認結果',r.deliveryNote)+check(esc,'delivered','この版の書面全体を実際に交付した')+'<button'+ctx.dis()+'>交付を記録する</button></form>';
  if(r.method==='paper'&&r.deliveredAt)h+='<form class="stack" data-form="em-paper"'+a+'>'+field(esc,'agreedAt','実際に双方が署名した日時','','datetime-local',true)+field(esc,'consenterName','署名した講師の氏名',s.staffName,'text',true)+area(esc,'evidenceRef','署名済み控えの非公開保管先（Drive等）')+check(esc,'signed','双方の署名と双方への控えの交付を確認した')+'<button'+ctx.dis()+'>紙での締結を記録する</button></form>';
 }
 if(!owner&&r.status==='issued'&&r.method==='electronic') {
  const prefForm='<form class="stack" data-form="em-preference"'+a+'>'+field(esc,'recipient','書面を受け取るメールアドレス',r.recipient||cache.staff.email,'email',true)+check(esc,'wish','保存・印刷できる書面の電子交付を希望します')+'<button'+(r.preferenceAt?'':' class="primary"')+ctx.dis()+'>受け取り方法を伝える</button><p class="small">紙を希望する場合は塾へお知らせください。</p></form>';
  if(!r.deliveredAt)h+=r.preferenceAt?'<p>受け取り先：'+esc(r.recipient)+'（'+esc(at(r.preferenceAt))+' に伝えました）</p>'+(r.preferenceAt<r.issuedAt?'':'<details><summary>受け取り先を変える</summary>'+prefForm+'</details>'):prefForm;
  else h+='<form class="stack" data-form="em-accept"'+a+'>'+field(esc,'consenterName','同意する本人の氏名','','text',true)+check(esc,'received','この版の書面全体を受け取り、自分で保存・印刷できます')+check(esc,'agree','この版の全文を確認し、記載された雇用条件に同意します')+'<button class="primary"'+ctx.dis()+'>この版に同意する</button></form>';
 }
 if(r.status==='agreed')h+='<p>合意した人：'+esc(r.consenterName)+'<br>合意日時：'+esc(at(r.agreedAt))+'<br>交付日時：'+esc(at(r.deliveredAt))+'</p>';
 if(owner&&['draft','issued'].includes(r.status))h+='<details><summary>案を取り下げる</summary><form class="stack" data-form="em-withdraw"'+a+'>'+field(esc,'reason','取り下げる理由','','text',true)+'<button'+ctx.dis()+'>この案を取り下げる</button></form></details>';
 return h+'</details>';
}
// 勤務予定・実績（本人は契約の合意後に通常の操作として出す。手続きの途中ですでに働いた日がある場合の入口は閉じた形で残す）
function workSection(ctx,d,owner,open,intro=''){
 const {esc}=ctx;
 let h=open?'<h2>勤務予定・実績</h2>'+intro:'<details><summary>すでに働いた日の記録</summary>';
 h+='<form class="stack" data-form="wk-open">'+field(esc,'date','確認する勤務日',today(),'date',true)+'<button'+ctx.dis()+'>この日の勤務を開く</button></form>'+(open?'<p><a href="#payroll">給与明細を確認する</a></p>':'');
 if(d.requests?.length)h+='<div class="notice"><strong>対応待ちの訂正申出</strong><ul>'+d.requests.map(x=>'<li><a href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'">'+esc(x.date)+'</a> '+esc(JSON.parse(x.detail).reason)+'</li>').join('')+'</ul></div>';
 if(d.days?.length)h+='<details open><summary>登録した勤務日</summary><ul>'+d.days.map(x=>'<li><a href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'">'+esc(x.date)+'</a> '+(x.payrollId?'給与反映済み':({draft:'実績未提出',submitted:'確認中',confirmed:'確認済み'}[x.status]))+'</li>').join('')+'</ul></details>';
 return h+(open?'':'</details>');
}
// 押せる行（設定の一覧と同じ見た目）
const linkRow=(esc,href,title,note)=>'<div class="group"><a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="'+esc(href)+'"><span class="v"><span class="lbl">'+esc(title)+'</span>'+(note?'<small>'+esc(note)+'</small>':'')+'</span><span class="go" aria-hidden="true">›</span></a></div>';
const bankLink=(esc,d)=>linkRow(esc,'#bank','給与の振込先',d.bank?.pending?'確認中':d.bank?.returned?'修正して登録し直してください':d.bank?.accepted?'確認済み':'未登録');
// 勤務開始前の勤務予定（代表が登録した予定だけ。日付を選ぶ欄や給与明細は勤務開始後に出す）
function plannedDays(ctx,d){
 const {esc}=ctx,days=(d.days||[]).filter(x=>x.planVersion).sort((a,b)=>a.date<b.date?-1:1);
 if(!days.length)return '<p class="small muted">勤務予定はまだありません。</p>';
 return '<div class="group">'+days.map(x=>'<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'"><span class="v"><span class="lbl">'+esc(jaDate(x.date))+'</span><small>'+(x.planAgreedVersion===x.planVersion?'予定を確認済み':'予定を確認してください')+'</small></span><span class="go" aria-hidden="true">›</span></a>').join('')+'</div>';
}
export function employmentPage(ctx,me,id='',opts={}){
 const owner=me.contractType==='owner',want=owner?(id||'list'):'mine';
 if(key!==want||!cache){load(ctx,want,owner?(id?'employment/get':'employment/list'):'employment/mine',id?{staffId:id}:{});return '<p>読み込んでいます…</p>';}
 if(cache.loading)return '<p>読み込んでいます…</p>';if(!cache.ok)return ctx.notice();
 const {esc}=ctx;let h=ctx.notice();
 if(owner&&!id){
  if(opts.newForm){
   const req='<span class="req">必須</span>',opt='<span class="opt">任意</span>';
   return h+'<form class="reg-form" style="margin-top:12px" data-form="em-new">'+
    '<fieldset class="reg-field"><legend>氏名 '+req+'</legend><div class="row" style="flex-wrap:nowrap;gap:10px"><label class="sub" style="flex:1 1 0;min-width:0">姓<input name="familyName" maxlength="30" required placeholder="例：山田"></label><label class="sub" style="flex:1 1 0;min-width:0">名<input name="givenName" maxlength="30" required placeholder="例：太郎"></label></div></fieldset>'+
    '<fieldset class="reg-field"><legend>メールアドレス '+opt+'</legend><label class="sub">招待メールの送り先<input type="email" name="email" maxlength="200" autocomplete="off" placeholder="例：taro@example.com"></label></fieldset>'+
    '<div class="stack"><button class="primary wide"'+ctx.dis()+'>登録する</button><a class="btn wide" href="#employment">やめて一覧に戻る</a></div></form>';
  }
  const stopped=!!opts.stopped,list=cache.staff.filter(s=>stopped?s.status==='stopped':s.status!=='stopped'),stoppedCount=cache.staff.filter(s=>s.status==='stopped').length;
  if(stopped)return h+(list.length?'<div class="group">'+list.map(s=>'<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#employment='+esc(s.id)+'"><span class="v"><span class="lbl">'+esc(s.name)+'</span><small>'+esc(s.email||'メール未登録')+'</small></span><span class="go" aria-hidden="true">›</span></a>').join('')+'</div>':'<p>停止中の講師はいません。</p>');
  h+='<div class="group">'+list.map(s=>{
   const g=s.registration||{},state=s.status==='stopped'?'停止中':g.pending?'本人情報の確認待ち':g.returned?'本人が登録し直し中':g.required&&!g.submitted?(s.status==='active'?(g.intent?'本人情報の登録待ち':'契約内容の確認待ち（本人）'):s.invitedAt?'招待済み・パスワードの設定待ち':'未招待'):s.contract?.status==='agreed'?(s.employmentAccess?'勤務中':'業務画面の利用待ち'):s.contract?.status==='issued'?(s.contract.deliveredAt?'本人の同意待ち':s.contract.method==='paper'?'契約書を渡す待ち':'契約書を送っています'):s.contract?.status==='draft'?'契約書の案（未発行）':g.accepted?'契約書の準備中':s.status==='active'?'アカウント利用中':s.invitedAt?'招待済み':'未招待';
   const extra=[s.bank?.pending?'振込先の確認待ち':'',s.pendingWork?'実績の確認 '+s.pendingWork+'件':'',s.pendingCorrections?'訂正の申し出 '+s.pendingCorrections+'件':''].filter(Boolean);
   return '<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#employment='+esc(s.id)+'"><span class="v"><span class="lbl">'+esc(s.name)+'</span><small>'+esc([state,...extra].join('・'))+'</small><small>'+esc(s.email||'メール未登録')+'</small></span><span class="go" aria-hidden="true">›</span></a>';
  }).join('')+'</div>'+(stoppedCount?linkRow(esc,'#employment-stopped','停止中の講師',stoppedCount+'件'):'');
  return h+'<a class="btn wide" style="margin-top:16px" href="#employment-new">＋ 新しい講師を登録する</a>';
 }
 const d=cache;
 if(owner){
  h+='<h1>'+esc(d.staff.name)+' さんの雇用・勤務</h1>';
  h+='<p><a href="#employment">講師一覧へ</a></p>'+stepper(d)+nextStep(ctx,d,true);
  if(d.registration?.pending)return h+ownerReview(ctx,d);
  const agreed=d.contracts.some(x=>x.status==='agreed'),active=d.contracts.filter(x=>x.status==='issued').concat(d.contracts.filter(x=>x.status==='draft'));
  let stage=stageOf(d);
  if(stage==='register'&&agreed){h+=personalInfo(ctx,d,true);stage=d.staff.employmentAccess?'working':'start';} // 締結後の登録し直し（引っ越しなど）
  const work=(intro='')=>workSection(ctx,d,true,true,intro);
  const pastWork=()=>d.requests?.length||d.days?.some(x=>x.status!=='draft'||!x.planVersion)?work():''; // 予定だけの日（最初の1か月のシフトなど）では出さない
  const bank=()=>linkRow(esc,'#bank='+d.staff.id,'給与の振込先',d.bank?.pending?'確認してください':d.bank?.returned?'本人の登録し直し待ち':d.bank?.accepted?'確認済み':'本人の登録待ち');
  // 1. 本人情報の登録まで: 招待と、本人の登録待ちだけ
  if(stage==='review'||stage==='register')return h+invitation(ctx,d)+personalInfo(ctx,d,true)+pastWork()+ownerRecords(ctx,d);
  // 2. 契約書の準備・交付: 契約書に載る内容を確かめて案を作り、発行して本人に送る
  if(stage==='prepare'||stage==='contract'){
   h+=invitation(ctx,d)+(active.length?active.map(r=>ownerContract(ctx,d,r)).join(''):ownerDraftForm(ctx,d));
   if(d.bank?.pending)h+='<h2>ほかに確認が必要なこと</h2>'+bank();
   return h+pastWork()+ownerRecords(ctx,d);
  }
  // 3. 締結のあと: 勤務開始の準備（給与・振込先・勤務予定・残っていること）、勤務中は勤務の記録を先に
  const contracts='<h2>契約書</h2>'+active.map(r=>ownerContract(ctx,d,r)).join('')+d.contracts.filter(x=>x.status==='agreed').map(r=>contractCard(ctx,r,true)).join('')+
   (active.length?'':'<details><summary>新しい契約書を作る（更新・条件の変更）</summary>'+ownerDraftForm(ctx,d,{again:true})+'</details>');
  if(stage==='start')return h+ownerTodo(ctx,d)+'<h2>給与</h2>'+bank()+ownerPay(ctx,d)+work(ownerShift(ctx,d))+contracts+ownerRecords(ctx,d);
  return h+work()+'<h2>給与</h2>'+bank()+ownerPay(ctx,d)+ownerTodo(ctx,d)+ownerShift(ctx,d)+contracts+ownerRecords(ctx,d);
 }
 // 本人: 段階に合わせて、今の操作に関係するものだけを出す
 const stage=stageOf(d),g=d.registration||{requests:[],version:0},r=g.requests.find(x=>x.id===g.latestId);
 h+=stepper(d);
 if(stage==='review'){
  const row=(k,v)=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>';
  h+='<h1>雇用契約の内容</h1>';
  h+='<section class="reg-card"><div class="reg-card-head"><h2>雇用契約書のひな形</h2></div>'+
   '<dl class="reg-rows">'+row('契約の形','期間の定めのある雇用（パート・アルバイト）。契約期間は契約のときに決めます')+row('働く場所','塾の教室（埼玉県越谷市袋山）')+row('仕事','小学生・中学生・高校生への個別指導の授業と、その準備・記録')+row('勤務','シフト制。平日18:00〜22:00、土日8:00〜22:00 の間で、前の月に話し合って決めます')+row('給与','時給制。月末締め・翌月25日払い（口座振込）。交通費は支給しません')+'</dl>'+
   '<button type="button" class="wide" style="margin-top:10px" data-action="em-template">全文を開く</button></section>';
  h+='<section class="reg-card"><div class="reg-card-head"><h2>講師マニュアル</h2></div><p class="reg-help" style="margin:6px 0 0">契約書の第9条で、このマニュアルに従うと定めています。</p>'+linkRow(esc,'#rules','講師マニュアルを読む','')+'</section>';
  h+='<form class="reg-form" style="margin-top:16px" data-form="em-intent"><label class="choice"><input type="checkbox" name="template" required><span>雇用契約書のひな形を読みました</span></label><label class="choice"><input type="checkbox" name="manual" required><span>講師マニュアルを読み、このとおりに仕事をします</span></label>'+
   '<button class="primary wide"'+ctx.dis()+'>この条件で雇用契約を結びたい</button></form>';
  return h+flowList(d);
 }
 if(stage==='register'){
  h+='<h1>本人情報の登録</h1>';
  if(g.returned)h+='<section class="notice"><h2 style="margin-top:0">本人情報を直して登録し直してください</h2><p>修正してほしい点：'+esc(r?.reason||'')+'</p></section>';
  return h+(regStep==='confirm'&&regDraft?registrationConfirm(ctx,g,false):registrationForm(ctx,g,r));
 }
 // 登録内容の修正（引っ越しなど）: 入力 → 確認 → 登録。いちばん上に出す
 if(regStep==='confirm'&&regDraft)return h+registrationConfirm(ctx,g,true);
 if(regStep==='edit')return h+'<h1>登録内容の修正</h1>'+registrationForm(ctx,g,r)+'<button type="button" class="wide" style="margin-top:10px" data-action="em-reg-cancel"'+ctx.dis()+'>修正をやめる</button>';
 h+=nextStep(ctx,d,false);
 if(stage==='pending')return h+registeredCard(ctx,d)+flowList(d);
 // 下の方にまとめる補足（自分の雇用情報・登録した本人情報・契約の履歴）
 const extra=()=>{
  let x=profile(ctx,d,false);
  if(d.registration?.required)x+='<details><summary>登録内容</summary>'+registeredCard(ctx,d)+'</details>';
  if(d.events?.length)x+='<details><summary>契約書の交付・同意の履歴</summary><ul>'+d.events.map(e=>'<li>'+esc(e.action)+'：'+esc(at(e.actualAt))+'</li>').join('')+'</ul></details>';
  return '<div style="margin-top:20px">'+x+'</div>';
 };
 const contracts=()=>d.contracts.length?'<h2>契約書</h2>'+d.contracts.map(r=>contractCard(ctx,r,false)).join(''):'';
 // 振込先は契約の成立後に聞く。それより前に出したもの（以前の流れ）があるときだけ、確認中・修正のお願いを見せる
 const bankSent=()=>d.bank?.pending||d.bank?.returned||d.bank?.accepted?'<h2>給与の振込先</h2>'+bankLink(esc,d):'';
 if(stage==='prepare'){
  h+=contracts()+bankSent();
  if(d.requests?.length||d.days?.some(x=>x.status!=='draft'||!x.planVersion))h+=workSection(ctx,d,false,false);
  return h+flowList(d)+extra();
 }
 if(stage==='contract'){
  h+=contracts()+bankSent();
  if(d.requests?.length||d.days?.some(x=>x.status!=='draft'||!x.planVersion))h+=workSection(ctx,d,false,false);
  return h+extra();
 }
 if(stage==='start'){
  h+='<h2>勤務開始の準備</h2>'+bankLink(esc,d)+linkRow(esc,'#rules','講師マニュアル',d.rulesReadAt?'読みました':'勤務を始める前に読んでください')+'<h2>勤務予定</h2>'+plannedDays(ctx,d);
  if(d.requests?.length||d.days?.some(x=>x.status!=='draft'||!x.planVersion))h+=workSection(ctx,d,false,false);
  return h+contracts()+extra();
 }
 h+=workSection(ctx,d,false,true)+'<h2>給与</h2>'+bankLink(esc,d)+contracts()+extra();
 return h;
}
const linesToText=list=>list.map(x=>x.start+'〜'+x.end+'　'+WORK[x.kind]+(x.label&&x.label!==WORK[x.kind]?'（'+x.label+'）':'')).join('\n');
const WEEK='日月火水木金土';
const dayJa=d=>jaDate(d)+'（'+WEEK[new Date(d+'T00:00:00Z').getUTCDay()]+'）';
// 勤務の日の画面（#work=講師/日付）。2026-10-18 本人「このページが分かりづらい。一般的なシフト管理の UI を参考に」:
// 日付と前後の日 → 進み具合（予定・本人の確認・実績・確定）→ 予定のカード（始業〜終業・時間・内訳）→ 実績のカード（予定どおりならボタン 1 つ）。
// 入力は 1 行 1 区間（開始・終了・種類・内容・削除）。説明の欄は任意で、空なら決まった文を記録に残す（API は記録の理由を必須にしている）
const toMin=t=>t?Number(t.slice(0,2))*60+Number(t.slice(3)):0;
const workMinutes=list=>(list||[]).filter(x=>x.kind!=='break').reduce((n,x)=>n+toMin(x.end)-toMin(x.start),0);
const hmJ=n=>n<60?n+'分':Math.floor(n/60)+'時間'+(n%60?n%60+'分':'');
const shiftSpan=list=>list?.length?list[0].start+'〜'+list[list.length-1].end:'';
const shiftDay=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const KIND_TAG={lesson:'',prep:'gray',other:'gray',meeting:'',break:'warn'};
function shiftSummary(esc,list,badge){
 if(!list?.length)return '';
 return '<div class="shift-head"><div><div class="shift-time">'+esc(shiftSpan(list))+'</div><div class="small muted">勤務 '+esc(hmJ(workMinutes(list)))+'（休憩を除く）</div></div>'+(badge||'')+'</div>'+
  '<ul class="shift-list">'+list.map(x=>'<li><span class="t">'+esc(x.start+'〜'+x.end)+'</span><span class="tag '+(KIND_TAG[x.kind]||'')+'">'+esc(WORK[x.kind]||x.kind)+'</span><span class="l">'+esc(x.label&&x.label!==WORK[x.kind]?x.label:'')+'</span></li>').join('')+'</ul>';
}
function intervalFields(ctx,kind,list) {
 const prior=drafts.get(location.hash+'|'+kind+'|');
 const count=Number(prior?.find(x=>x.name==='rowCount')?.value||Math.max(1,list.length));
 return '<input type="hidden" name="rowCount" value="'+count+'"><div class="shift-rows"><div class="shift-row shift-row-head" aria-hidden="true"><span>開始</span><span></span><span>終了</span><span>種類</span><span>内容（任意）</span><span></span></div>'+Array.from({length:count},(_,i)=>{
  const x=list[i]||{},e=ctx.esc;
  return '<div class="shift-row"><input type="time" step="300" name="start_'+i+'" aria-label="開始" value="'+e(x.start||'')+'"><span class="sep">〜</span><input type="time" step="300" name="end_'+i+'" aria-label="終了" value="'+e(x.end==='24:00'?'00:00':x.end||'')+'"><select name="kind_'+i+'" aria-label="仕事の種類">'+Object.entries(WORK).map(([k,t])=>'<option value="'+k+'"'+(k===(x.kind||'lesson')?' selected':'')+'>'+e(t)+'</option>').join('')+'</select><input name="label_'+i+'" aria-label="内容" placeholder="内容（任意）" maxlength="200" value="'+e(x.label||'')+'"><button type="button" class="icon" data-action="wk-del" data-i="'+i+'" aria-label="この行を消す">×</button></div>';
 }).join('')+'</div><button type="button" class="wide" style="margin-top:8px" data-action="wk-add">＋ 時間を追加</button><p class="reg-help" style="margin:4px 0 0">時間が重なるときは一度だけ入れます。夜 0:00 はその日の終わりです。</p>';
}
function readIntervals(v){
 return Array.from({length:Number(v.rowCount||0)},(_,i)=>({start:v['start_'+i],end:v['end_'+i],kind:v['kind_'+i],label:v['label_'+i]})).map(x=>({...x,end:x.end==='00:00'&&x.start&&x.start!=='00:00'?'24:00':x.end})).filter(x=>x.start||x.end);
}
const hiddenIntervals=(esc,list)=>'<input type="hidden" name="rowCount" value="'+list.length+'">'+list.map((x,i)=>['start','end','kind','label'].map(k=>'<input type="hidden" name="'+k+'_'+i+'" value="'+esc(x[k]||'')+'">').join('')).join('');
const memo=(esc,label,ph)=>'<label class="sub" style="margin-top:8px"><span>'+esc(label)+' <span class="opt">任意</span></span><input name="reason" maxlength="500" placeholder="'+esc(ph)+'"></label>';
export function workPage(ctx,me,id,date){
 const want=id+'/'+date,owner=me.contractType==='owner';
 if(dayKey!==want||!dayCache){dayEdit='';load(ctx,want,'work/day',{staffId:id,date},true);return '<p>読み込んでいます…</p>';}
 if(dayCache.loading)return '<p>読み込んでいます…</p>';if(!dayCache.ok)return ctx.notice();
 const {esc}=ctx,r=dayCache.day||{version:0,planned:[],actual:[]},a=' data-staff="'+esc(id)+'" data-date="'+esc(date)+'" data-version="'+r.version+'"';
 const future=date>today(),hasPlan=!!(r.planVersion&&r.planned?.length),agreed=hasPlan&&r.planAgreedAt&&r.planVersion===r.planAgreedVersion;
 const submitted=r.status==='submitted'||r.status==='confirmed',confirmed=r.status==='confirmed';
 const name=owner&&cache?.staff?.id===id?cache.staff.name:'';
 const nav=d=>'<a class="btn" href="#work='+esc(id)+'/'+esc(d)+'">'+(d<date?'‹ ':'')+esc(Number(d.slice(5,7))+'/'+Number(d.slice(8)))+(d>date?' ›':'')+'</a>';
 let h=ctx.notice()+'<p style="margin:12px 0 4px"><a href="#employment'+(owner?'='+esc(id):'')+'">'+(owner?'雇用・勤務へ戻る':'自分の雇用・勤務へ戻る')+'</a></p>';
 h+='<div class="day-nav">'+nav(shiftDay(date,-1))+'<h1>'+esc(dayJa(date))+(name?'<small>'+esc(name)+'</small>':'')+'</h1>'+nav(shiftDay(date,1))+'</div>';
 // 進み具合: 予定 → 本人の確認 → 実績 → 確定
 const step=!hasPlan?0:!agreed&&!submitted?1:!submitted?2:!confirmed?3:4;
 h+='<ol class="steps four" aria-label="この日の勤務の進み具合">'+['予定','本人の確認','実績','確定'].map((t,k)=>'<li class="'+(k<step?'done':k===step?'now':'')+'"'+(k===step?' aria-current="step"':'')+'><span class="n">'+(k<step?'✓':k+1)+'</span><span class="t">'+t+'</span></li>').join('')+'</ol>';
 // 1. 勤務予定
 const planBadge=hasPlan?(agreed?'<span class="tag ok">本人確認済み</span>':'<span class="tag warn">本人の確認待ち</span>'):'';
 h+='<section class="reg-card"><div class="reg-card-head"><h2>勤務予定</h2>'+(owner&&hasPlan&&dayEdit!=='plan'&&!submitted&&!r.payrollId?'<button type="button" class="small-btn" data-action="wk-plan-edit"'+ctx.dis()+'>予定を変える</button>':'')+'</div>';
 if(owner&&(dayEdit==='plan'||!hasPlan)){
  const base=hasPlan?r.planned:dayCache.suggestion;
  h+='<form class="reg-form" style="margin-top:8px" data-form="wk-plan"'+a+'>'+intervalFields(ctx,'wk-plan',base||[])+memo(esc,'メモ','例：初日なので見学から')+
   '<div class="stack"><button class="primary wide"'+ctx.dis()+'>予定を保存</button>'+(hasPlan?'<button type="button" class="wide" data-action="wk-edit-cancel"'+ctx.dis()+'>やめる</button>':'')+'</div></form>';
 } else if(hasPlan){
  h+=shiftSummary(esc,r.planned,planBadge);
  if(!owner&&!agreed)h+='<form class="reg-form" style="margin-top:10px" data-form="wk-agree"'+a+'><label class="choice"><input type="checkbox" name="agree" required><span>この予定で働きます</span></label><button class="primary wide"'+ctx.dis()+'>予定を確認しました</button></form>';
 } else h+='<p class="small muted" style="margin:8px 0 0">この日の勤務予定はありません。</p>';
 h+='</section>';
 // 2. 実際の勤務
 const actualBadge=confirmed?'<span class="tag ok">確定</span>':submitted?'<span class="tag warn">確認中</span>':'';
 h+='<section class="reg-card"><div class="reg-card-head"><h2>実際の勤務</h2>'+(submitted&&!r.payrollId&&dayEdit!=='actual'?'<button type="button" class="small-btn" data-action="wk-actual-edit"'+ctx.dis()+'>直す</button>':'')+'</div>';
 if(future&&!submitted)h+='<p class="small muted" style="margin:8px 0 0">勤務した日のあとに入力します。</p>';
 else if(dayEdit==='actual'||(!submitted&&!hasPlan)||(!submitted&&dayEdit==='actual')){
  const base=submitted?r.actual:hasPlan?r.planned:dayCache.suggestion;
  h+='<form class="reg-form" style="margin-top:8px" data-form="wk-submit"'+a+' data-mode="edit">'+intervalFields(ctx,'wk-submit',base||[])+
   '<label class="sub" style="margin-top:8px"><span>補足 <span class="opt">任意</span></span><textarea name="note" rows="2" maxlength="1500" placeholder="例：授業が取消になり、30分で帰った">'+esc(r.note||'')+'</textarea></label>'+memo(esc,'直した理由','例：終わりが10分のびた')+
   '<div class="stack"><button class="primary wide"'+ctx.dis()+'>'+(submitted?'直して出す':'実績を出す')+'</button>'+(submitted||hasPlan?'<button type="button" class="wide" data-action="wk-edit-cancel"'+ctx.dis()+'>やめる</button>':'')+'</div></form>';
 } else if(submitted){
  h+=shiftSummary(esc,r.actual,actualBadge)+(r.note?'<p class="small" style="margin:6px 0 0">補足：'+esc(r.note)+'</p>':'');
  if(r.payrollId)h+='<p class="small muted" style="margin:6px 0 0">給与に反映済みです。</p>';
  if(owner&&r.status==='submitted')h+='<form class="reg-form" style="margin-top:10px" data-form="wk-confirm"'+a+'>'+memo(esc,'確認のメモ','例：休憩なしで問題なし')+'<label class="choice"><input type="checkbox" name="reviewed" required><span>実績と休憩、必要な賃金の調整を確かめました</span></label><button class="primary wide"'+ctx.dis()+'>確定して給与に入れる</button></form>';
 } else {
  // 予定どおりなら、ボタン 1 つで出す。違ったときだけ入力する
  h+='<form class="reg-form" style="margin-top:8px" data-form="wk-submit"'+a+' data-mode="asPlanned">'+hiddenIntervals(esc,r.planned)+'<button class="primary wide"'+ctx.dis()+'>予定どおり働いた（'+esc(shiftSpan(r.planned))+'）</button></form>'+
   '<button type="button" class="wide" style="margin-top:8px" data-action="wk-actual-edit"'+ctx.dis()+'>時間が違ったので入力する</button>';
 }
 if(submitted&&dayCache.warnings?.issues.length)h+='<div class="notice" style="margin-top:10px"><ul style="margin:0;padding-left:1.2em">'+dayCache.warnings.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p class="small" style="margin:6px 0 0">割増や休業手当は給与の調整で確かめます。</p></div>';
 h+='</section>';
 // 3. 訂正の申し出・記録の履歴（めったに使わない）
 if(r.version)h+='<details style="margin-top:16px"><summary>訂正の申し出・記録の履歴</summary><form class="stack" data-form="wk-correction"'+a+'>'+area(esc,'reason','訂正してほしい内容')+'<button'+ctx.dis()+'>訂正の申し出を記録</button></form><ul>'+(dayCache.corrections||[]).map(x=>{
  const answers=(dayCache.answers||[]).filter(y=>JSON.parse(y.detail).requestId===x.id);
  return '<li>'+esc(at(x.at))+' '+esc(JSON.parse(x.detail).reason)+answers.map(y=>'<p>回答：'+esc(JSON.parse(y.detail).message)+'（'+esc(at(y.at))+'）</p>').join('')+(owner?'<form class="stack" data-form="wk-reply" data-id="'+x.id+'"'+a+'><input type="hidden" name="requestId" value="'+x.id+'">'+area(esc,'message','対応結果')+'<button'+ctx.dis()+'>対応結果を記録する</button></form>':'')+'</li>';
 }).join('')+'</ul><details><summary>以前の勤務記録</summary>'+dayCache.history.map(x=>'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">第'+x.version+'版 '+esc(at(x.recordedAt))+'\n'+esc(linesToText(JSON.parse(x.snapshot).actual))+'\n'+esc(x.reason)+'</pre>').join('')+'</details></details>';
 return h;
}
export async function employmentSubmit(ctx,kind,el){
 if(!kind.startsWith('em-')&&!kind.startsWith('wk-'))return false;
 const v=Object.fromEntries(new FormData(el).entries()),b={id:el.dataset.id,version:Number(el.dataset.version),hash:el.dataset.hash,staffId:el.dataset.staff||cache?.staff?.id,date:el.dataset.date};
 for(const n of ['agree','wish','received','delivered','signed','confirm','reviewed'])v[n]=el.elements.namedItem(n)?.checked===true;
 let route,body={...b,...v},msg='保存しました';
 try{
  if(kind==='em-new'){route='employment/save';body={...v,data:{}};}
  else if(kind==='em-intent'){
   if(!el.elements.namedItem('template').checked||!el.elements.namedItem('manual').checked)throw Error('読んだことを確かめる印を、両方に付けてください');
   const rules=await ctx.call('employment/rules/get');if(!rules.ok)throw Error(rules.error.message);
   route='employment/intent';body={rulesHash:rules.hash,confirm:true};msg='申し込みました。';
  }
  else if(kind==='em-registration'){
   const t=x=>String(x||'').trim(),zip=t(v.zip).replace(/^(\d{3})(\d{4})$/,'$1-$2'),E={};
   if(!t(v.familyName)||!t(v.givenName))E.name='姓と名を入力してください';
   if(!t(v.zip))E.zip='郵便番号を入力してください';else if(!/^\d{3}-\d{4}$/.test(zip))E.zip='郵便番号は 343-0002 のように 7 桁の数字で入力してください';
   if(!t(v.addr))E.addr='住所を入力してください';
   if(!v.otherEmployment)E.otherEmployment='「ない」か「ある」を選んでください';
   else if(v.otherEmployment==='yes'&&!t(v.otherWorkHours))E.otherWorkHours='その勤務先で働く曜日と時間を入力してください';
   if(!v.taxSituation)E.taxSituation='どれか 1 つを選んでください';
   if(!v.delivery)E.delivery='「メール」か「紙」を選んでください';
   else if(v.delivery==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t(v.recipient)))E.recipient='受け取るメールアドレスを確かめてください';
   regErrors=E;
   if(Object.keys(E).length){ctx.say('');regFocus=true;return true;}
   regDraft={familyName:t(v.familyName),givenName:t(v.givenName),address:'〒'+zip+' '+t(v.addr),otherEmployment:v.otherEmployment,otherWorkHours:v.otherEmployment==='yes'?t(v.otherWorkHours):'',taxSituation:v.taxSituation,availability:v.availability||'',delivery:v.delivery,recipient:v.delivery==='email'?t(v.recipient).toLowerCase():''};
   regStep='confirm';ctx.say('');scrollTo(0,0);return true;
  }
  else if(kind==='em-registration-confirm'){if(!regDraft){regStep='input';return true;}route='employment/registration/submit';body={version:Number(el.dataset.version),confirm:true,data:regDraft};msg='登録が完了しました。';}
  else if(kind==='em-registration-accept'||kind==='em-registration-return'){route='employment/registration/review';body={...b,requestId:el.dataset.request,profileVersion:Number(el.dataset.profileVersion),outcome:kind==='em-registration-accept'?'accepted':'returned',confirm:kind==='em-registration-accept',reason:v.reason,nameDecision:v.nameDecision||''};msg=kind==='em-registration-accept'?'本人情報を受け付けました。':'修正依頼を記録しました。';}
  else if(kind==='em-draft'){
   if(!v.employmentInsurance)throw Error('雇用保険に加入するかを選んでください');
   if(!v.method)throw Error('締結の方法を選んでください');
   let r=await ctx.call('employment/save',{staffId:cache.staff.id,version:Number(el.dataset.version),data:Object.fromEntries(['startDate','endDate','weeklyHours','hourly','employmentInsurance','address','otherWork'].filter(k=>k in v).map(k=>[k,v[k]]))});
   if(!r.ok){if(!ctx.handleAuth(r))ctx.say(r.error.message,'error');return true;}
   r=await ctx.call('employment/get',{staffId:cache.staff.id});if(!r.ok)throw Error(r.error.message);
   route='employment/contract/create';body={staffId:cache.staff.id,version:r.profile.version,method:v.method};msg='契約書の案を作りました。';
  }
  else if(kind==='em-shift'){route='employment/save';body={...b,data:{availability:v.availability}};msg='シフトのメモを保存しました';}
  else if(kind==='em-todo'){route='employment/save';const data={preparationNote:v.preparationNote};for(const k of ['insuranceChecked','bankConsentChecked']){const e=el.elements.namedItem(k);if(e)data[k]=e.checked;}body={...b,data};}
  else if(kind==='em-pay'){
   if(!v.taxDeclaration)throw Error('扶養控除等申告書の区分を選んでください');
   if(v.taxDeclaration==='submitted'&&v.dependents==='')throw Error('甲欄のときは扶養人数を入れてください（0 人でも）');
   const p=cache.profile?.data;if(!p?.startDate)throw Error('先に「契約の条件」で契約期間を保存してください');
   let r=await ctx.call('employment/save',{staffId:cache.staff.id,version:Number(el.dataset.version),data:{taxDeclaration:v.taxDeclaration,dependents:v.taxDeclaration==='submitted'?v.dependents:'',taxCheckedOn:v.taxCheckedOn}});
   if(!r.ok)throw Error(r.error.message);
   r=await ctx.call('payroll/rates/save',{staffId:cache.staff.id,startsOn:p.startDate.slice(0,7),lessonHourly:hourlyOf(cache),meetingHourly:null});
   if(!r.ok)throw Error('申告書の区分は保存しました。時給は確認が必要です：'+r.error.message);
   r=await ctx.call('payroll/withholding',{staffId:cache.staff.id,version:cache.staff.version,taxColumn:v.taxDeclaration==='submitted'?'kou':'otsu',dependents:Number(v.dependents||0)});
   if(!r.ok)throw Error('時給は保存しました。源泉徴収の区分は確認が必要です：'+r.error.message);
   drafts.delete(formKey(el));cache=null;ctx.say('給与の設定を保存しました','ok');return true;
  }
  else if(kind==='em-email'){route='employment/email';msg='メールアドレスを保存しました。メールは送っていません。';}
  else if(kind==='em-issue'){route='employment/contract/issue';msg=cache?.profile?.data?.deliveryMethod==='electronic'?'発行しました。本人が希望したメールアドレスへ契約書を送ります。':'発行しました。本人の画面に契約書が出ています。';}
  else if(kind==='em-withdraw')route='employment/contract/withdraw';
  else if(kind==='em-delivery'){route='employment/contract/delivery';body.deliveredAt=v.deliveredAt+':00+09:00';msg='記録しました。';}
  else if(kind==='em-paper'){route='employment/contract/paper';body.agreedAt=v.agreedAt+':00+09:00';}
  else if(kind==='em-preference')route='employment/contract/preference';
  else if(kind==='em-accept')route='employment/contract/accept';
  else if(kind==='em-invite'){route='employment/invite';msg='招待を受け付けました。送信状況を確認してください。';}
  else if(kind==='em-payroll'){
   if(!v.agree)throw Error('給与へ反映する内容を確認してください');
   const p=cache.profile?.data;if(!p?.startDate||!p.taxDeclaration||!p.taxCheckedOn||(p.taxDeclaration==='submitted'&&p.dependents===''))throw Error('契約開始日と申告書の確認を先に保存してください');
   let r=await ctx.call('payroll/rates/save',{staffId:cache.staff.id,startsOn:p.startDate.slice(0,7),lessonHourly:hourlyOf(cache),meetingHourly:null});
   if(!r.ok)throw Error(r.error.message);
   r=await ctx.call('payroll/withholding',{staffId:cache.staff.id,version:cache.staff.version,taxColumn:p.taxDeclaration==='submitted'?'kou':'otsu',dependents:Number(p.dependents||0)});
   if(!r.ok)throw Error('時給は保存しました。源泉区分は確認が必要です：'+r.error.message);
   drafts.delete(formKey(el));cache=null;ctx.say('時給と源泉区分を保存しました','ok');return true;
  }
  else if(kind==='wk-open'){drafts.delete(formKey(el));location.hash='#work='+encodeURIComponent(cache.staff.id)+'/'+v.date;return true;}
  else if(kind==='wk-plan'){route='work/plan';body.intervals=readIntervals(v);body.reason=String(v.reason||'').trim()||(b.version?'勤務予定を変更':'勤務予定を登録');msg='予定を保存しました';}
  else if(kind==='wk-submit'){route='work/submit';body.intervals=readIntervals(v);body.reason=String(v.reason||'').trim()||(el.dataset.mode==='asPlanned'?'予定どおり勤務':'実績を入力');msg='実績を出しました';}
  else if(kind==='wk-agree'){route='work/plan/agree';msg='予定を確認しました';}
  else if(kind==='wk-confirm'){route='work/confirm';body.reason=String(v.reason||'').trim()||'実績を確認';msg='確定しました';}
  else if(kind==='wk-reply'){route='work/correction/respond';msg='対応結果を記録しました。';}
  else if(kind==='wk-correction'){route='work/correction';msg='訂正の申し出を受け付けました。確認してお知らせします。';}
  if(!route)return false;
  const r=await ctx.call(route,body);
  if(!r.ok){if(!ctx.handleAuth(r))ctx.say(r.error.message,'error');return true;}
  if(kind.startsWith('wk-'))dayEdit='';drafts.delete(formKey(el));if(kind==='em-registration-confirm'){regStep='input';regMode='new';regDraft=null;drafts.delete(location.hash+'|em-registration|');scrollTo(0,0);}if(kind==='em-registration-accept'||kind==='em-registration-return'){for(const k of drafts.keys())if(k.startsWith(location.hash+'|em-profile|'))drafts.delete(k);}if(kind==='em-email')drafts.delete(location.hash+'|em-invite|');cache=null;dayCache=null;
  if(kind==='em-new')location.hash='#employment='+encodeURIComponent(r.staff.id);
  if(kind==='em-accept'&&ctx.refreshMe){await ctx.refreshMe();msg='同意しました。契約が成立し、講師として授業や勤務の画面が使えるようになりました。';}
  ctx.say(msg,'ok');return true;
 }catch(e){ctx.say(e.message,'error');return true;}
}
export async function employmentClick(ctx,a,b){
 if(a==='em-reg-back'){regStep=regMode==='edit'?'edit':'input';ctx.say('');return true;}
 if(a==='em-reg-edit'){regStep='edit';regMode='edit';regDraft=null;regErrors={};drafts.delete(location.hash+'|em-registration|');ctx.say('');scrollTo(0,0);return true;}
 if(a==='em-reg-cancel'){regStep='input';regMode='new';regDraft=null;regErrors={};drafts.delete(location.hash+'|em-registration|');ctx.say('');return true;}
 if(a==='wk-plan-edit'||a==='wk-actual-edit'){dayEdit=a==='wk-plan-edit'?'plan':'actual';ctx.say('');return true;}
 if(a==='wk-edit-cancel'){dayEdit='';for(const k of [...drafts.keys()])if(k.startsWith(location.hash+'|wk-'))drafts.delete(k);ctx.say('');return true;}
 if(a==='wk-del'){ // 行を消す: 入力中の値を 1 行ずつ詰めて、行の数を 1 つ減らす（最後の 1 行は空にする）
  const form=b.closest('form');captureEmployment();
  const rows=drafts.get(formKey(form))||[],get=n=>rows.find(x=>x.name===n),cnt=get('rowCount'),n=Number(cnt?.value||0),i=Number(b.dataset.i);
  if(n<=1){for(const f of ['start','end','label'])if(get(f+'_0'))get(f+'_0').value='';}
  else{for(let j=i;j<n-1;j++)for(const f of ['start','end','kind','label']){const to=get(f+'_'+j),from=get(f+'_'+(j+1));if(to&&from)to.value=from.value;}cnt.value=String(n-1);}
  ctx.render();return true;
 }
 if(a==='wk-add'){
  const form=b.closest('form');captureEmployment();
  const rows=drafts.get(formKey(form))||[],c=rows.find(x=>x.name==='rowCount');
  if(c&&Number(c.value)<80)c.value=String(Number(c.value)+1);
  ctx.render();return true;
 }
 if(a!=='em-activate')return false;
 const r=await ctx.call('employment/activate',{staffId:cache.staff.id});
 if(r.ok){cache=null;ctx.say('業務画面を利用できるようにしました','ok');}else if(!ctx.handleAuth(r))ctx.say(r.error.message,'error');
 return true;
}
