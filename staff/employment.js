// Employment and actual work. Owner manages; each employee sees only their own data.
let cache=null, key='', dayCache=null, dayKey='', drafts=new Map();
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
let regStep='input',regDraft=null,regErrors={},regFocus=false; // 本人情報の登録: 入力 → 確認 → 登録。regErrors は項目ごとの入力漏れ
export function resetEmployment(){cache=null;dayCache=null;key='';dayKey='';drafts.clear();regStep='input';regDraft=null;regErrors={};}
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
// 本人の段階（2026-10-17 本人「その時点ですること・待つこと・次に進む条件を整理する」）:
//  register（まず本人情報を登録）→ pending（代表の確認待ち）→ prepare（代表が勤務条件・契約書を準備）→ contract（契約書の確認・同意）→ start（振込先・勤務予定）→ working（業務画面を利用中）。
//  以前の登録方式の講師（registration.required が false）は register・pending を通らない。
function stageOf(d){
 const g=d.registration||{},issued=d.contracts.some(x=>x.status==='issued'),agreed=d.contracts.some(x=>x.status==='agreed');
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
  '</div>'+err('name')+'<p class="reg-help">契約書に載る氏名です。</p></fieldset>'+
  '<fieldset class="'+cls('zip','addr')+'"><legend>現住所 '+req+'</legend>'+
   text('zip','郵便番号',zip,'required inputmode="numeric" autocomplete="postal-code" pattern="\\d{3}-?\\d{4}" maxlength="8" placeholder="例：343-0002" style="max-width:11em"')+
   text('addr','住所（都道府県から建物名・部屋番号まで）',addr,'required autocomplete="street-address" maxlength="480" placeholder="例：埼玉県越谷市袋山1-2-3 ○○ハイツ101"')+err('zip','addr')+
  '</fieldset>'+
  '<fieldset class="'+cls('otherEmployment','otherWorkHours')+'"><legend>ほかに雇われて働いている勤務先 '+req+'</legend><p class="reg-help">アルバイト・パートを含みます。業務委託や自営は含めません。</p>'+
   radio('otherEmployment',[['no','ない'],['yes','ある']],p.otherEmployment)+err('otherEmployment')+
   '<div class="ow-hours">'+text('otherWorkHours','その勤務先で働く曜日と時間（おおよそ）',p.otherWorkHours,'maxlength="1000" placeholder="例：月・水 17時〜21時"')+err('otherWorkHours')+'<p class="reg-help">勤務先の名前は不要です。労働時間は雇われている勤務先どうしで合算されるため、確認しています。</p></div>'+
  '</fieldset>'+
  '<fieldset class="'+cls('taxSituation')+'"><legend>扶養控除等申告書 '+req+'</legend><p class="reg-help">年末調整のための書類です。今年、ほかの勤務先に出しているかを選んでください。</p>'+
   radio('taxSituation',[['noneElsewhere','ほかの勤務先には出していない'],['otherEmployer','ほかの勤務先に出している'],['unknown','分からない・確認中','この回答で税の区分が決まることはありません。代表が確認します。']],p.taxSituation)+err('taxSituation')+
  '</fieldset>'+
  (p.availability?'<input type="hidden" name="availability" value="'+esc(p.availability)+'">':'')+
  '<div class="stack"><button class="primary wide"'+ctx.dis()+'>入力内容を確認する</button><p class="small muted" style="margin:0">マイナンバーや口座番号は、ここでは入力しません。</p></div></form>';
}
// 確認画面: 入力した内容を一覧で見せ、「この内容で登録する」で初めて送る
function registrationConfirm(ctx,g,again){
 const {esc}=ctx;
 return '<section class="reg-confirm"><h2>入力内容の確認</h2><p>内容に間違いがなければ「この内容で登録する」を押してください。</p>'+registrationSummary(esc,regDraft)+
  '<form class="stack" data-form="em-registration-confirm" data-version="'+g.version+'"><button class="primary wide"'+ctx.dis()+'>この内容で登録する</button><button type="button" class="wide" data-action="em-reg-back"'+ctx.dis()+'>入力画面に戻って直す</button><p class="small muted" style="margin:0">登録した内容は代表が確認します。雇用契約への同意ではありません。'+(again?'登録し直すと、代表の確認が済むまで契約書の発行は待ちになります。':'')+'</p></form></section>';
}
function personalInfo(ctx,d,owner){
 const {esc}=ctx,g=d.registration||{requests:[],version:0},r=g.requests.find(x=>x.id===g.latestId);
 const p=r?.data||d.profile?.data||{};
 let h='<section id="personal-info"><h2>本人情報</h2>';
 if(owner){
  if(!r)return h+'<p>'+ (g.required?'本人が氏名・住所などを登録します。代表による事前入力は不要です。':'この講師は以前の登録方式です。既存の情報・契約はそのまま利用できます。')+'</p></section>';
  h+='<p class="small muted">本人の登録：'+esc(at(r.submittedAt))+' ／ '+esc(REG_STATUS[r.status])+'</p>';
 }
 const nameNote=owner&&r?.status==='pending'&&r.nameDiffers?'<br><span class="tag warn">招待時の表示名と違います</span> <span class="small muted">招待時：'+esc(d.staff.name)+'</span>':'';
 if(r)h+=registrationSummary(esc,p,nameNote);
 if(r?.reason&&r.status==='returned')h+='<p class="notice">修正してほしい内容：'+esc(r.reason)+'</p>';
 if(owner&&r?.status==='pending'){
  const data=' data-version="'+g.version+'" data-request="'+esc(r.id)+'" data-hash="'+esc(r.contentHash)+'" data-profile-version="'+(d.profile?.version||0)+'"';
  h+='<form class="stack" data-form="em-registration-accept"'+data+'>'+
   (r.nameDiffers?'<fieldset style="min-width:0;border:1px solid #d5dce1;border-radius:8px;padding:12px"><legend>氏名の扱い</legend><label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="radio" name="nameDecision" value="apply" required> 本人の入力「'+esc(r.submittedName)+'」を表示名に反映する</label><label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="radio" name="nameDecision" value="keep" required> 今の表示名「'+esc(d.staff.name)+'」のままにする（本人と確認してから直す）</label><p class="small muted">発行済みの契約書・同意の記録・ログインのメールアドレスは変わりません。これから作る契約書には反映後の氏名が載ります。</p></fieldset>':'')+
   '<p class="small">現住所・ほかの勤務先の申告を雇用情報に反映します。申告書の正式な提出状況と給与区分は、勤務条件の欄で別途確認します。発行済みの契約書は変わりません。</p><button class="primary"'+ctx.dis()+'>本人情報を確認して反映する</button></form><details><summary>修正を依頼する</summary><form class="stack" data-form="em-registration-return"'+data+'>'+area(esc,'reason','修正してほしい内容')+'<button'+ctx.dis()+'>修正を依頼する</button></form></details>';
 }
 if(!owner){
  const stage=stageOf(d);
  if(stage==='pending')h+='<details><summary>登録した内容を直して登録し直す</summary>'+registrationForm(ctx,g,r)+'</details>';
  else if(stage!=='register'&&g.required)h+='<details><summary>登録した本人情報を直す（引っ越しなど）</summary>'+registrationForm(ctx,g,r)+'</details>';
 }
 if(g.requests.length>1)h+='<details><summary>本人情報の登録履歴</summary><ul>'+g.requests.map(x=>'<li>'+esc(at(x.submittedAt))+'：'+esc(REG_STATUS[x.status])+(x.reason?'（'+esc(x.reason)+'）':'')+'</li>').join('')+'</ul></details>';
 return h+'</section>';
}
function invitation(ctx,d){
 if(d.staff.status!=='invited')return '';
 const {esc}=ctx;let h='<section><h2>本人を招待する</h2><p>まず本人が情報を登録します。今必要なのは氏名とメールアドレスだけです。</p>';
 if(!d.profile?.invitedAt)h+='<form class="stack" data-form="em-email" data-version="'+d.staff.version+'">'+field(esc,'email','本人のメールアドレス（招待前に登録）',d.staff.email||'','email')+'<button'+ctx.dis()+'>メールアドレスを保存</button></form>';
 if(d.staff.email)h+='<form class="stack" data-form="em-invite"><input type="hidden" name="email" value="'+esc(d.staff.email)+'">'+check(esc,'confirm',d.staff.email+' へ招待メールを送る。再送時は前のリンクが無効になります。')+'<button class="primary"'+ctx.dis()+'>招待メールを送る</button></form>';
 else h+='<p>招待するには、本人のメールアドレスを登録してください。</p>';
 if(d.inviteDelivery)h+='<p class="small">招待の送信状況：'+esc({pending:'送信待ち',sent:'送信済み',failed:'確認が必要',dismissed:'送信なし'}[d.inviteDelivery.status]||d.inviteDelivery.status)+' '+esc(d.inviteDelivery.error||'')+'</p>';
 return h+'</section>';
}
// 画面の先頭: 今すること（または待っていること）を 1 つだけ
function nextStep(ctx,d,owner){
 const g=d.registration||{},issued=d.contracts.find(x=>x.status==='issued'),agreed=d.contracts.some(x=>x.status==='agreed');
 let title,body,wait=false;
 if(owner){
  if(d.staff.status==='invited'){title=d.profile?.invitedAt?'本人のアカウント設定待ち':'まず招待メールを送ってください';body=d.profile?.invitedAt?'本人がパスワードを設定すると、本人情報の登録に進めます。':'氏名や住所は、招待後に本人が入力します。';wait=!!d.profile?.invitedAt;}
  else if(g.pending){title='登録された本人情報を確認してください';body='下の内容を確認して反映すると、勤務条件の設定に進めます。';}
  else if(g.required&&(!g.accepted||g.returned)){title='本人情報の登録待ち';body=g.returned?'修正した情報の登録し直しを待っています。':'本人の画面に登録欄を表示しています。';wait=true;}
  else {title='勤務条件と契約の準備を進めてください';body='本人と勤務希望を確認して勤務条件を保存し、契約書の発行・交付へ進めます。';}
 }else{
  const stage=stageOf(d);
  if(stage==='register'){title=g.returned?'本人情報を直して登録し直してください':'まず本人情報を登録してください';body=g.returned?'代表からの修正依頼を下に表示しています。':'下の欄に氏名・現住所などを入力し、「本人情報を登録する」を押してください。';}
  else if(stage==='pending'){title='本人情報を登録しました。代表の確認待ちです';body='代表が内容を確認します。確認が済むと、勤務条件と契約書の準備に進みます。';wait=true;}
  else if(stage==='contract'){title=issued.deliveredAt?'届いた契約書を確認してください':issued.preferenceAt?'契約書の交付待ちです':'契約書と受け取り方法を確認してください';body=issued.deliveredAt?'受け取った書面を保存し、内容を確認してから、この版への同意を行ってください。':issued.preferenceAt?'指定した受け取り先へ代表が書面を交付します。':'下の契約書を開き、電子または紙で受け取る方法を確認してください。';wait=!!issued.preferenceAt&&!issued.deliveredAt;}
  else if(stage==='prepare'){title='代表が勤務条件・契約書を準備しています';body='契約書が発行されると、この画面から確認できます。その間に、給与の振込先を登録できます。';wait=true;}
  else if(!d.bank?.accepted){title=d.bank?.pending?'振込先は代表の確認待ちです':'給与の振込先を登録してください';body=d.bank?.pending?'口座の確認後、勤務予定の確認へ進みます。':'下の「給与の振込先」から口座情報を入力し、振込への同意を提出してください。';wait=!!d.bank?.pending;}
  else {const plan=d.days?.find(x=>x.planVersion&&x.planVersion!==x.planAgreedVersion);title=plan?'勤務予定を確認してください':d.staff.employmentAccess?'入職の準備が整っています':'初日の勤務予定・代表の最終確認待ちです';body=plan?'下に表示された勤務日を開き、予定を確認してください。':'予定が登録されると、この画面で確認できます。実際に働いた時間も勤務日から登録します。';wait=!plan&&!d.staff.employmentAccess;}
 }
 return '<section class="notice" style="overflow-wrap:anywhere"><h2 style="margin-top:0">'+ctx.esc(title)+'</h2><p>'+ctx.esc(body)+'</p>'+(wait?'<p class="small muted">'+(owner?'本人の対応を待っています。':'代表の対応を待っています。')+'</p>':'')+'</section>';
}
const STEPS=['本人情報','代表の確認','契約書','振込先','勤務開始'];
function stepIndex(d){const s=stageOf(d);return s==='register'?0:s==='pending'?1:s==='prepare'||s==='contract'?2:s==='start'?(d.bank?.accepted?4:3):5;}
function stepper(d){
 const i=stepIndex(d);if(i>4)return '';
 return '<ol class="steps" aria-label="入職の手続きの進み具合">'+STEPS.map((t,k)=>'<li class="'+(k<i?'done':k===i?'now':'')+'"'+(k===i?' aria-current="step"':'')+'><span class="n">'+(k<i?'✓':k+1)+'</span><span class="t">'+t+'</span></li>').join('')+'</ol>';
}
const FLOW='<p class="small">手続きの順番：本人情報の登録 → 代表による確認・勤務条件の設定 → 契約書の交付・同意 → 振込先・勤務予定の確認 → 勤務開始</p>';

function profile(ctx,d,owner){
 const {esc}=ctx,p=d.profile?.data||{};
 if(!owner)return '<details><summary>自分の雇用情報</summary><p>'+esc(d.staff.name)+'<br>'+esc(p.startDate||'未登録')+'〜'+esc(p.endDate||'未登録')+'<br>'+(p.availability?'勤務希望：'+esc(p.availability):'')+'</p><p>誤りがある場合は代表へお知らせください。</p></details>';
 return '<details'+(d.registration?.required&&!d.registration.accepted?'':' open')+'><summary>勤務条件・代表の確認事項</summary><form class="stack" data-form="em-profile" data-staff="'+esc(d.staff.id)+'" data-version="'+(d.profile?.version||0)+'">'+
 (d.registration?.required?'':field(esc,'address','住所（以前の登録情報）',p.address))+
 '<div class="row">'+field(esc,'startDate','契約開始日',p.startDate||'','date')+field(esc,'endDate','契約終了日',p.endDate||'','date')+'</div>'+
 field(esc,'workWindow','塾全体の勤務時間帯（本人と確認）',p.workWindow||'')+
 field(esc,'weeklyHours','勤務時間の目安',p.weeklyHours||'週5〜6時間ほど。')+
 area(esc,'availability','勤務希望（本人と確認した、勤務できる曜日・時間）',p.availability||'')+
 (d.registration?.required?'':area(esc,'otherWork','他の勤務先・勤務時間（ない場合は「なし」）',p.otherWork))+
 select(esc,'taxDeclaration','扶養控除等申告書の確認',[['','未確認'],['submitted','塾に提出する（甲欄）'],['notSubmitted','塾に提出しない（乙欄）']],p.taxDeclaration)+
 field(esc,'dependents','扶養人数（甲欄の場合は0人も入力）',p.dependents||'','number')+
 field(esc,'taxCheckedOn','申告書の確認日',p.taxCheckedOn,'date')+
 area(esc,'preparationNote','勤務条件・未確定事項を確認した内容',p.preparationNote)+
 check(esc,'conditionsChecked','契約ひな形の確認事項と、この講師の勤務条件を確認した',p.conditionsChecked)+
 check(esc,'bankConsentChecked','別途受領した振込先・振込同意を確認した（本人画面での電子提出とは別の記録）',p.bankConsentChecked)+
 area(esc,'insuranceNote','労働保険等の確認状況・次の手続き',p.insuranceNote)+
 check(esc,'insuranceChecked','必要な事業所の届出・保険の確認を済ませた',p.insuranceChecked)+
 '<p class="small muted">口座番号は「給与の振込先」で本人が入力します。マイナンバーはこの画面に入力しません。保存だけではメール送信・契約締結を行いません。</p><button class="primary"'+ctx.dis()+'>勤務条件を保存</button></form></details>';
}
function contractCard(ctx,r,owner){
 const {esc}=ctx,a=attrs(r),s=r.snapshot;
 let h='<details class="sheet"'+(r.status==='issued'?' open':'')+'><summary>第'+r.revision+'版（'+(r.method==='paper'?'紙':'電子')+'）・'+STATUS[r.status]+'</summary><p>契約期間：'+esc(jaDate(s.startDate))+'〜'+esc(jaDate(s.endDate))+'</p><button type="button" data-action="em-doc"'+a+'>全文を開く・PDF保存</button><details><summary>この版の本文を確認</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">'+esc(s.text)+'</pre></details>';
 if(owner&&r.status==='draft')h+='<form class="stack" data-form="em-issue"'+a+'>'+check(esc,'agree','この版の全文を確認し、代表としてこの条件での契約に合意して発行する')+'<button'+ctx.dis()+'>この版を発行する</button></form>';
 if(r.status==='issued'&&owner) {
  h+='<p class="small">発行した書面全体を交付してから、実際の交付を記録してください。画面に置いたことだけで交付済みにはしません。</p>';
  if(r.method==='electronic')h+='<p>電子交付の希望：'+(r.preferenceAt?esc(r.recipient)+'（'+esc(at(r.preferenceAt))+'）':'本人の確認待ち')+'</p>';
  if(r.method==='paper'||r.preferenceAt)h+='<form class="stack" data-form="em-delivery"'+a+'>'+field(esc,'deliveredAt','実際に交付した日時','','datetime-local',true)+area(esc,'note','交付方法・送付先・確認結果',r.deliveryNote)+check(esc,'delivered','この版の書面全体を実際に交付した')+'<button'+ctx.dis()+'>交付を記録する</button></form>';
  if(r.method==='paper'&&r.deliveredAt)h+='<form class="stack" data-form="em-paper"'+a+'>'+field(esc,'agreedAt','実際に双方が署名した日時','','datetime-local',true)+field(esc,'consenterName','署名した講師の氏名',s.staffName,'text',true)+area(esc,'evidenceRef','署名済み控えの非公開保管先（Drive等）')+check(esc,'signed','双方の署名と双方への控えの交付を確認した')+'<button'+ctx.dis()+'>紙での締結を記録する</button></form>';
 }
 if(!owner&&r.status==='issued'&&r.method==='electronic') {
  const prefForm='<form class="stack" data-form="em-preference"'+a+'>'+field(esc,'recipient','書面を受け取るメールアドレス',r.recipient||cache.staff.email,'email',true)+check(esc,'wish','保存・印刷できる書面の電子交付を希望します')+'<button'+(r.preferenceAt?'':' class="primary"')+ctx.dis()+'>受け取り方法を伝える</button><p class="small">紙を希望する場合は代表へお知らせください。この操作は契約内容への同意ではありません。</p></form>';
  if(!r.deliveredAt)h+=r.preferenceAt?'<p>受け取り先：'+esc(r.recipient)+'（'+esc(at(r.preferenceAt))+' に伝えました）<br><span class="small muted">代表がこの宛先へ書面を送ります。届いたら、この画面で同意します。</span></p><details><summary>受け取り先を変える</summary>'+prefForm+'</details>':prefForm;
  else h+='<form class="stack" data-form="em-accept"'+a+'>'+field(esc,'consenterName','同意する本人の氏名','','text',true)+check(esc,'received','この版の書面全体を受け取り、自分で保存・印刷できます')+check(esc,'agree','この版の全文を確認し、記載された雇用条件に同意します')+'<button class="primary"'+ctx.dis()+'>この版に同意する</button></form>';
 }
 if(r.status==='agreed')h+='<p>合意した人：'+esc(r.consenterName)+'<br>合意日時：'+esc(at(r.agreedAt))+'<br>交付日時：'+esc(at(r.deliveredAt))+'</p>';
 if(owner&&['draft','issued'].includes(r.status))h+='<details><summary>案を取り下げる</summary><form class="stack" data-form="em-withdraw"'+a+'>'+field(esc,'reason','取り下げる理由','','text',true)+'<button'+ctx.dis()+'>この案を取り下げる</button></form></details>';
 return h+'</details>';
}
// 勤務予定・実績（本人は契約の合意後に通常の操作として出す。手続きの途中ですでに働いた日がある場合の入口は閉じた形で残す）
function workSection(ctx,d,owner,open){
 const {esc}=ctx;
 let h=open?'<h2>勤務予定・実績</h2>':'<details><summary>すでに働いた日の記録</summary><p class="small muted">手続きの途中で、すでに働いた日がある場合に使います。</p>';
 h+='<form class="stack" data-form="wk-open">'+field(esc,'date','確認する勤務日',today(),'date',true)+'<button'+ctx.dis()+'>この日の勤務を開く</button></form>'+(open?'<p><a href="#payroll">給与明細を確認する</a></p>':'');
 if(d.requests?.length)h+='<div class="notice"><strong>対応待ちの訂正申出</strong><ul>'+d.requests.map(x=>'<li><a href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'">'+esc(x.date)+'</a> '+esc(JSON.parse(x.detail).reason)+'</li>').join('')+'</ul></div>';
 if(d.days?.length)h+='<details open><summary>登録した勤務日（新しい60日分）</summary><ul>'+d.days.map(x=>'<li><a href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'">'+esc(x.date)+'</a> '+(x.payrollId?'給与反映済み':({draft:'実績未提出',submitted:'代表の確認待ち',confirmed:'代表確認済み'}[x.status]))+'</li>').join('')+'</ul></details>';
 return h+(open?'':'</details>');
}
// 押せる行（設定の一覧と同じ見た目）
const linkRow=(esc,href,title,note)=>'<div class="group"><a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="'+esc(href)+'"><span class="v"><span class="lbl">'+esc(title)+'</span><small>'+esc(note)+'</small></span><span class="go" aria-hidden="true">›</span></a></div>';
const bankLink=(esc,d)=>linkRow(esc,'#bank','給与の振込先',d.bank?.pending?'代表の確認待ち':d.bank?.returned?'修正して登録し直してください':d.bank?.accepted?'確認済み':'未登録：本人名義の口座を登録します');
// 勤務開始前の勤務予定（代表が登録した予定だけ。日付を選ぶ欄や給与明細は勤務開始後に出す）
function plannedDays(ctx,d){
 const {esc}=ctx,days=(d.days||[]).filter(x=>x.planVersion).sort((a,b)=>a.date<b.date?-1:1);
 if(!days.length)return '<p class="small muted">初日の勤務予定が決まると、ここに出ます。</p>';
 return '<div class="group">'+days.map(x=>'<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#work='+esc(d.staff.id)+'/'+esc(x.date)+'"><span class="v"><span class="lbl">'+esc(jaDate(x.date))+'</span><small>'+(x.planAgreedVersion===x.planVersion?'予定を確認済み':'予定を確認してください')+'</small></span><span class="go" aria-hidden="true">›</span></a>').join('')+'</div>';
}
export function employmentPage(ctx,me,id=''){
 const owner=me.contractType==='owner',want=owner?(id||'list'):'mine';
 if(key!==want||!cache){load(ctx,want,owner?(id?'employment/get':'employment/list'):'employment/mine',id?{staffId:id}:{});return '<p>読み込んでいます…</p>';}
 if(cache.loading)return '<p>読み込んでいます…</p>';if(!cache.ok)return ctx.notice();
 const {esc}=ctx;let h=ctx.notice();
 if(owner&&!id){
  h+='<p>氏名・メールアドレスで招待し、本人情報の登録を受けてから勤務条件と契約を整えます。</p><div class="group">'+cache.staff.map(s=>'<a class="todo-row" href="#employment='+esc(s.id)+'"><span>'+esc(s.name)+'<br><small>'+esc(s.email||'メール未登録')+'・'+(s.status==='active'?'アカウント利用中':s.invitedAt?'招待済み':'未招待')+(s.registration?.pending?'・本人情報の確認待ち':'')+(s.bank?.pending?'・振込先の確認待ち':'')+(s.pendingWork?'・実績確認 '+s.pendingWork+'件':'')+(s.pendingCorrections?'・訂正申出 '+s.pendingCorrections+'件':'')+'</small></span></a>').join('')+'</div>';
  return h+'<details open><summary>新しい講師を登録する</summary><form class="stack" data-form="em-new">'+field(esc,'familyName','姓','','text',true)+field(esc,'givenName','名','','text',true)+field(esc,'email','本人のメールアドレス（下書きでは任意）','','email')+'<p class="small muted">未定の場合は空欄で保存できます。本人への招待時に登録してください。氏名は本人が登録時に入力し直します。</p>'+'<button class="primary"'+ctx.dis()+'>下書きを保存（メールは送りません）</button></form></details>';
 }
 const d=cache;
 if(owner){
  h+='<h1>'+esc(d.staff.name)+' さんの雇用・勤務</h1>';
  h+='<p><a href="#employment">講師一覧へ</a></p>'+nextStep(ctx,d,true)+FLOW+invitation(ctx,d)+personalInfo(ctx,d,true)+profile(ctx,d,true);
  const regOpen=d.registration?.required&&(!d.registration.accepted||d.registration.pending||d.registration.returned);
  h+='<h2>契約書・締結の控え</h2>'+(regOpen?'<p class="small muted">本人情報の確認が済むと、ここで契約書の案を作れます。</p>':'<p class="small">保存済みの勤務条件から案を作成します。発行・交付・合意をそれぞれ記録し、古い版も残します。</p><form class="stack" data-form="em-create" data-version="'+(d.profile?.version||0)+'">'+select(esc,'method','締結方法',[['','方法を選んでください'],['paper','紙で署名する'],['electronic','電子で同意する']])+'<button'+ctx.dis()+'>保存済みの条件から契約書案を作る</button></form>');
  h+=d.contracts.map(r=>contractCard(ctx,r,true)).join('')||'<p>契約書はまだありません。</p>';
  if(d.events?.length)h+='<details><summary>交付・同意の履歴</summary><ul>'+d.events.map(e=>'<li>'+esc(e.action)+'：'+esc(at(e.actualAt))+'／記録 '+esc(at(e.recordedAt))+' '+esc(e.actorName)+'</li>').join('')+'</ul></details>';
  // 本人情報の確認前は、給与・勤務の準備を出さない（本人の画面と同じ順番。すでに勤務の記録がある場合だけ勤務の欄を残す）
  if(regOpen)return h+'<h2>給与・勤務の準備</h2><p class="small muted">振込先・給与の設定・勤務予定は、本人情報の確認が済んでから進めます。</p>'+(d.days?.length||d.requests?.length?workSection(ctx,d,true,true):'');
  h+='<h2>給与の準備</h2>'+linkRow(esc,'#bank='+d.staff.id,'給与の振込先',d.bank?.pending?'確認してください（本人が登録済み）':d.bank?.returned?'本人の登録し直し待ち':d.bank?.accepted?'確認済み':'本人の登録待ち');
  h+='<p>契約の時給は授業・その他業務とも2,000円、面談は当面担当せず未設定です。</p><form class="stack" data-form="em-payroll">'+check(esc,'agree','確認済みの申告書区分と契約の時給を給与設定へ反映する')+'<button'+ctx.dis()+'>契約に合わせて給与を設定</button></form><p><a href="#rates">時給・源泉徴収の履歴を確認</a></p>';
  h+='<details><summary>業務画面を利用する前の確認</summary><ul>'+d.checks.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+(d.checks.length?'':'準備項目の確認がそろっています。');
  if(!d.staff.employmentAccess)h+='<button data-action="em-activate"'+ctx.dis()+'>準備を確認して業務画面を利用可能にする</button>';
  h+='</details>'+workSection(ctx,d,true,true);
  return h;
 }
 // 本人: 段階に合わせて、今の操作に関係するものだけを出す
 const stage=stageOf(d),g=d.registration||{requests:[],version:0},r=g.requests.find(x=>x.id===g.latestId);
 h+=stepper(d);
 if(stage==='register'){
  h+='<h1>本人情報の登録</h1>';
  if(g.returned)h+='<section class="notice"><h2 style="margin-top:0">本人情報を直して登録し直してください</h2><p>代表からの修正依頼：'+esc(r?.reason||'')+'</p></section>';
  else if(regStep!=='confirm')h+='<p>勤務を始めるために、ご本人の情報を登録してください。登録した内容は代表が確認します。入力は 3 分ほどで終わります。</p>';
  h+=regStep==='confirm'&&regDraft?registrationConfirm(ctx,g,false):registrationForm(ctx,g,r);
  return h+'<details style="margin-top:24px"><summary>この後の手続き</summary>'+FLOW+'<p>代表が本人情報を確認し、勤務条件を整えてから契約書をご案内します。給与の振込先や勤務予定は、契約のあとに登録します。</p></details>';
 }
 if(regStep==='confirm'&&regDraft)return h+registrationConfirm(ctx,g,true); // 登録し直すときの確認画面は、いちばん上に出す
 h+=nextStep(ctx,d,false);
 if(stage==='pending'){
  h+=personalInfo(ctx,d,false)+'<details><summary>この後の手続き</summary>'+FLOW+'<p>代表が本人情報を確認し、勤務条件を整えてから契約書をご案内します。給与の振込先や勤務予定は、契約のあとに登録します。</p></details>';
  return h;
 }
 // 下の方にまとめる補足（自分の雇用情報・登録した本人情報・契約の履歴）
 const extra=()=>{
  let x=profile(ctx,d,false);
  if(d.registration?.required)x+='<details><summary>登録した本人情報</summary>'+personalInfo(ctx,d,false)+'</details>';
  if(d.events?.length)x+='<details><summary>契約書の交付・同意の履歴</summary><ul>'+d.events.map(e=>'<li>'+esc(e.action)+'：'+esc(at(e.actualAt))+'</li>').join('')+'</ul></details>';
  return '<div style="margin-top:20px">'+x+'</div>';
 };
 const contracts=()=>d.contracts.length?'<h2>契約書</h2>'+d.contracts.map(r=>contractCard(ctx,r,false)).join(''):'';
 if(stage==='prepare'){
  h+=contracts()+'<h2>契約と並行してできること</h2>'+bankLink(esc,d);
  if(d.days?.length||d.requests?.length)h+=workSection(ctx,d,false,false);
  return h+'<details style="margin-top:20px"><summary>この後の手続き</summary>'+FLOW+'</details>'+extra();
 }
 if(stage==='contract'){
  h+=contracts()+'<h2>契約と並行してできること</h2>'+bankLink(esc,d);
  if(d.days?.length||d.requests?.length)h+=workSection(ctx,d,false,false);
  return h+extra();
 }
 if(stage==='start'){
  h+='<h2>勤務開始の準備</h2>'+bankLink(esc,d)+'<h2>勤務予定</h2>'+plannedDays(ctx,d);
  if(d.requests?.length||d.days?.some(x=>x.status!=='draft'||!x.planVersion))h+=workSection(ctx,d,false,false);
  return h+contracts()+extra();
 }
 h+=workSection(ctx,d,false,true)+'<h2>給与</h2>'+bankLink(esc,d)+contracts()+extra();
 return h;
}
const linesToText=list=>list.map(x=>x.start+'〜'+x.end+'　'+WORK[x.kind]+(x.label&&x.label!==WORK[x.kind]?'（'+x.label+'）':'')).join('\n');
const WEEK='日月火水木金土';
const dayJa=d=>jaDate(d)+'（'+WEEK[new Date(d+'T00:00:00Z').getUTCDay()]+'）';
function intervalFields(ctx,kind,list) {
 const prior=drafts.get(location.hash+'|'+kind+'|');
 const count=Number(prior?.find(x=>x.name==='rowCount')?.value||Math.max(1,list.length));
 return '<input type="hidden" name="rowCount" value="'+count+'">'+Array.from({length:count},(_,i)=>{
  const x=list[i]||{};
  return '<fieldset style="min-width:0;margin:8px 0;border:1px solid #d5dce1;border-radius:8px;padding:12px"><legend>時間 '+(i+1)+'</legend><div class="row">'+field(ctx.esc,'start_'+i,'開始',x.start||'','time')+field(ctx.esc,'end_'+i,'終了',x.end==='24:00'?'00:00':x.end||'','time')+'</div>'+select(ctx.esc,'kind_'+i,'仕事の種類',Object.entries(WORK),x.kind||'other')+field(ctx.esc,'label_'+i,'内容（任意）',x.label||'')+'</fieldset>';
 }).join('')+'<button type="button" data-action="wk-add">時間の行を追加</button><p class="small muted">不要な行は開始・終了を両方空欄にしてください。</p>';
}
function readIntervals(v){
 return Array.from({length:Number(v.rowCount||0)},(_,i)=>({start:v['start_'+i],end:v['end_'+i],kind:v['kind_'+i],label:v['label_'+i]})).map(x=>({...x,end:x.end==='00:00'&&x.start&&x.start!=='00:00'?'24:00':x.end})).filter(x=>x.start||x.end);
}
export function workPage(ctx,me,id,date){
 const want=id+'/'+date,owner=me.contractType==='owner';
 if(dayKey!==want||!dayCache){load(ctx,want,'work/day',{staffId:id,date},true);return '<p>読み込んでいます…</p>';}
 if(dayCache.loading)return '<p>読み込んでいます…</p>';if(!dayCache.ok)return ctx.notice();
 const {esc}=ctx,r=dayCache.day||{version:0,planned:[],actual:[]},a=' data-staff="'+esc(id)+'" data-date="'+esc(date)+'" data-version="'+r.version+'"';
 const future=date>today();
 let h=ctx.notice()+(owner?'<p><a href="#employment='+esc(id)+'">雇用・勤務へ戻る</a></p>':'')+'<h1>'+esc(dayJa(date))+'の勤務</h1>';
 if(owner)h+='<details open><summary>勤務予定</summary><form class="stack" data-form="wk-plan"'+a+'>'+intervalFields(ctx,'wk-plan',r.planVersion?r.planned:dayCache.suggestion)+field(esc,'reason','予定・変更の説明','','text',true)+'<button'+ctx.dis()+'>勤務予定を保存</button></form></details>';
 else h+='<h2>勤務予定</h2><pre style="white-space:pre-wrap">'+esc(linesToText(r.planned))+'</pre>';
 h+='<p>本人の予定確認：'+(r.planAgreedAt&&r.planVersion===r.planAgreedVersion?'確認済み':'未確認')+'</p>';
 if(!owner&&r.planVersion&&r.planVersion!==r.planAgreedVersion)h+='<form class="stack" data-form="wk-agree"'+a+'>'+check(esc,'agree','この勤務予定を確認し、同意します')+'<button class="primary"'+ctx.dis()+'>勤務予定を確認する</button></form>';
 if(!owner&&future&&!r.submittedAt)return h+'<h2>実際の勤務</h2><p class="small muted">実際に働いた時間は、勤務した日のあとにこの画面で記録します。</p>';
 h+='<h2>実際の勤務</h2><p class="small">この日の授業・準備・その他業務をすべて記録してください。授業、見学・研修、準備・記録、休憩の時間を分けて入力します。時間が重なる場合は一度だけ登録し、終了の0:00はその日の終わりを表します。入力した日の給与は、この実績全体で計算します。</p><p>状態：'+esc({draft:'実績未提出',submitted:'代表の確認待ち',confirmed:'代表確認済み'}[r.status]||'未登録')+'</p>';
 if(!r.payrollId)h+='<form class="stack" data-form="wk-submit"'+a+'>'+intervalFields(ctx,'wk-submit',r.submittedAt?r.actual:r.planVersion?r.planned:dayCache.suggestion)+area(esc,'note','補足（取消・休業、途中交代など）',r.note||'')+field(esc,'reason','記録・訂正の理由','','text',true)+'<button class="primary"'+ctx.dis()+'>実績を提出する</button></form>';
 else h+='<p>給与に反映済みです。訂正が必要な場合は、下の欄から代表へ申し出てください。</p><pre style="white-space:pre-wrap">'+esc(linesToText(r.actual))+'</pre>';
 if(dayCache.warnings?.issues.length)h+='<div class="notice"><ul>'+dayCache.warnings.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>実際に働いた時間は残します。必要な割増・休業手当等は給与の調整で確認します。</p></div>';
 if(owner&&r.status==='submitted')h+='<form class="stack" data-form="wk-confirm"'+a+'>'+field(esc,'reason','実績・休憩・賃金調整を確認した内容','','text',true)+check(esc,'reviewed','実際の勤務と必要な賃金調整を確認しました')+'<button'+ctx.dis()+'>実績を確認して給与へ反映</button></form>';
 if(r.version)h+='<details><summary>訂正の申し出・履歴</summary><form class="stack" data-form="wk-correction"'+a+'>'+area(esc,'reason','訂正してほしい内容')+'<button'+ctx.dis()+'>訂正の申し出を記録</button></form><ul>'+(dayCache.corrections||[]).map(x=>{
  const answers=(dayCache.answers||[]).filter(y=>JSON.parse(y.detail).requestId===x.id);
  return '<li>'+esc(at(x.at))+' '+esc(JSON.parse(x.detail).reason)+answers.map(y=>'<p>代表の回答：'+esc(JSON.parse(y.detail).message)+'（'+esc(at(y.at))+'）</p>').join('')+(owner?'<form class="stack" data-form="wk-reply" data-id="'+x.id+'"'+a+'><input type="hidden" name="requestId" value="'+x.id+'">'+area(esc,'message','対応結果（勤務実績や給与の訂正は別途保存）')+'<button'+ctx.dis()+'>対応結果を記録する</button></form>':'')+'</li>';
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
  else if(kind==='em-registration'){
   const t=x=>String(x||'').trim(),zip=t(v.zip).replace(/^(\d{3})(\d{4})$/,'$1-$2'),E={};
   if(!t(v.familyName)||!t(v.givenName))E.name='姓と名を入力してください';
   if(!t(v.zip))E.zip='郵便番号を入力してください';else if(!/^\d{3}-\d{4}$/.test(zip))E.zip='郵便番号は 343-0002 のように 7 桁の数字で入力してください';
   if(!t(v.addr))E.addr='住所を入力してください';
   if(!v.otherEmployment)E.otherEmployment='「ない」か「ある」を選んでください';
   else if(v.otherEmployment==='yes'&&!t(v.otherWorkHours))E.otherWorkHours='その勤務先で働く曜日と時間を入力してください';
   if(!v.taxSituation)E.taxSituation='どれか 1 つを選んでください';
   regErrors=E;
   if(Object.keys(E).length){ctx.say('');regFocus=true;return true;}
   regDraft={familyName:t(v.familyName),givenName:t(v.givenName),address:'〒'+zip+' '+t(v.addr),otherEmployment:v.otherEmployment,otherWorkHours:v.otherEmployment==='yes'?t(v.otherWorkHours):'',taxSituation:v.taxSituation,availability:v.availability||''};
   regStep='confirm';ctx.say('');scrollTo(0,0);return true;
  }
  else if(kind==='em-registration-confirm'){if(!regDraft){regStep='input';return true;}route='employment/registration/submit';body={version:Number(el.dataset.version),confirm:true,data:regDraft};msg='登録が完了しました。代表の確認をお待ちください。';}
  else if(kind==='em-registration-accept'||kind==='em-registration-return'){route='employment/registration/review';body={...b,requestId:el.dataset.request,profileVersion:Number(el.dataset.profileVersion),outcome:kind==='em-registration-accept'?'accepted':'returned',confirm:kind==='em-registration-accept',reason:v.reason,nameDecision:v.nameDecision||''};msg=kind==='em-registration-accept'?'本人情報を確認して反映しました。本人と勤務希望を確認し、勤務条件を設定してください。':'修正依頼を記録しました。';}
  else if(kind==='em-profile'){route='employment/save';body={...b,data:{...v,...Object.fromEntries(['conditionsChecked','bankConsentChecked','insuranceChecked'].map(k=>[k,el.elements.namedItem(k).checked]))}};}
  else if(kind==='em-email'){route='employment/email';msg='メールアドレスを保存しました。メールは送っていません。';}
  else if(kind==='em-create')route='employment/contract/create';
  else if(kind==='em-issue')route='employment/contract/issue';
  else if(kind==='em-withdraw')route='employment/contract/withdraw';
  else if(kind==='em-delivery'){route='employment/contract/delivery';body.deliveredAt=v.deliveredAt+':00+09:00';}
  else if(kind==='em-paper'){route='employment/contract/paper';body.agreedAt=v.agreedAt+':00+09:00';}
  else if(kind==='em-preference')route='employment/contract/preference';
  else if(kind==='em-accept')route='employment/contract/accept';
  else if(kind==='em-invite'){route='employment/invite';msg='招待を受け付けました。送信状況を確認してください。';}
  else if(kind==='em-payroll'){
   if(!v.agree)throw Error('給与へ反映する内容を確認してください');
   const p=cache.profile?.data;if(!p?.startDate||!p.taxDeclaration||!p.taxCheckedOn||(p.taxDeclaration==='submitted'&&p.dependents===''))throw Error('契約開始日と申告書の確認を先に保存してください');
   let r=await ctx.call('payroll/rates/save',{staffId:cache.staff.id,startsOn:p.startDate.slice(0,7),lessonHourly:2000,meetingHourly:null});
   if(!r.ok)throw Error(r.error.message);
   r=await ctx.call('payroll/withholding',{staffId:cache.staff.id,version:cache.staff.version,taxColumn:p.taxDeclaration==='submitted'?'kou':'otsu',dependents:Number(p.dependents||0)});
   if(!r.ok)throw Error('時給は保存しました。源泉区分は確認が必要です：'+r.error.message);
   drafts.delete(formKey(el));cache=null;ctx.say('時給と源泉区分を保存しました','ok');return true;
  }
  else if(kind==='wk-open'){drafts.delete(formKey(el));location.hash='#work='+encodeURIComponent(cache.staff.id)+'/'+v.date;return true;}
  else if(kind==='wk-plan'){route='work/plan';body.intervals=readIntervals(v);}
  else if(kind==='wk-submit'){route='work/submit';body.intervals=readIntervals(v);}
  else if(kind==='wk-agree')route='work/plan/agree';
  else if(kind==='wk-confirm')route='work/confirm';
  else if(kind==='wk-reply'){route='work/correction/respond';msg='対応結果を記録しました。';}
  else if(kind==='wk-correction'){route='work/correction';msg='訂正の申し出を記録しました。代表が確認します。';}
  if(!route)return false;
  const r=await ctx.call(route,body);
  if(!r.ok){if(!ctx.handleAuth(r))ctx.say(r.error.message,'error');return true;}
  drafts.delete(formKey(el));if(kind==='em-registration-confirm'){regStep='input';regDraft=null;drafts.delete(location.hash+'|em-registration|');scrollTo(0,0);}if(kind==='em-registration-accept'||kind==='em-registration-return'){for(const k of drafts.keys())if(k.startsWith(location.hash+'|em-profile|'))drafts.delete(k);}if(kind==='em-email')drafts.delete(location.hash+'|em-invite|');cache=null;dayCache=null;
  if(kind==='em-new')location.hash='#employment='+encodeURIComponent(r.staff.id);
  ctx.say(msg,'ok');return true;
 }catch(e){ctx.say(e.message,'error');return true;}
}
export async function employmentClick(ctx,a,b){
 if(a==='em-reg-back'){regStep='input';ctx.say('');return true;}
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
