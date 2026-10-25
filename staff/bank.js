// Bank details stay in this page's memory only; never in localStorage, URLs, mail or generic employment drafts.
let key='',cache=null,draft=null,step='view',agreed=false,ownerConfirm=false,reason='';
const fields=[['bankName','金融機関名'],['bankCode','金融機関コード（4桁・任意）'],['branchName','支店名'],['branchCode','支店コード（3桁・任意）'],['accountType','預金種別'],['accountNumber','振込用の口座番号（7桁）'],['holderKana','口座名義（カナ）']];
const types={ordinary:'普通',current:'当座'};
const at=v=>v?new Date(Date.parse(v)+9*3600e3).toISOString().slice(0,16).replace('T',' '):'';
export function resetBank(){key='';cache=null;draft=null;step='view';agreed=false;ownerConfirm=false;reason='';}
export function captureBank(){
 const edit=document.querySelector('[data-form="bank-edit"]');
 if(edit)draft=Object.fromEntries(new FormData(edit));
 const submit=document.querySelector('[data-form="bank-submit"]');if(submit)agreed=submit.elements.agree.checked;
 const accept=document.querySelector('[data-form="bank-accept"]');if(accept)ownerConfirm=accept.elements.confirm.checked;
 const returned=document.querySelector('[data-form="bank-return"]');if(returned)reason=returned.elements.reason.value;
}
const box=(ctx,name,label,checked=false)=>'<label style="display:flex;gap:8px;align-items:start"><input style="width:auto" type="checkbox" name="'+name+'"'+(checked?' checked':'')+' required> '+ctx.esc(label)+'</label>';
function accountHtml(ctx,a,full=false){
 return '<dl style="overflow-wrap:anywhere">'+fields.map(([k,label])=>'<dt>'+ctx.esc(label)+'</dt><dd>'+ctx.esc(k==='accountType'?types[a[k]]:k==='accountNumber'&&!full?'••••'+a[k].slice(-3):a[k]||'未入力')+'</dd>').join('')+'</dl>';
}
function record(ctx,r){
 const labels={pending:'確認中',accepted:r.current?'確認済み・現在の振込先':'以前に確認した振込先',returned:'修正して再提出',superseded:'新しい提出に置き換え'};
 return '<section class="card"><h3>'+ctx.esc(labels[r.status])+'</h3>'+accountHtml(ctx,r.account)+
 '<details><summary>口座情報と同意の全文を確認</summary>'+accountHtml(ctx,r.account,true)+'<p>'+ctx.esc(r.consentText)+'</p><p>同意した人：'+ctx.esc(r.consenterName)+'<br>同意・提出日時：'+ctx.esc(at(r.submittedAt))+'</p></details>'+
 (r.reviewedAt?'<p>確認日時：'+ctx.esc(at(r.reviewedAt))+'</p>':'')+(r.reason?'<p>修正してほしい内容：'+ctx.esc(r.reason)+'</p>':'')+'</section>';
}
export function bankPage(ctx,me,id=''){
 const owner=me.contractType==='owner',want=owner?id:me.id;
 if(owner&&!id)return ctx.notice()+'<p><a href="#employment">講師を選んでください</a></p>';
 if(key!==want||!cache){
  key=want;cache={loading:true};ctx.call('employment/bank/get',owner?{staffId:id}:{}).then(r=>{
   if(key!==want)return;cache=r;if(!r.ok&&!ctx.handleAuth(r))ctx.say(r.error.message,'error');ctx.render();
  }).catch(()=>{if(key===want){cache={ok:false};ctx.say('振込先を読み込めませんでした。画面を更新してください','error');ctx.render();}});
  return '<p>読み込んでいます…</p>';
 }
 if(cache.loading)return '<p>読み込んでいます…</p>';if(!cache.ok)return ctx.notice();
 const {esc}=ctx,d=cache,latest=d.requests.find(r=>r.id===d.latestId),current=d.requests.find(r=>r.id===d.acceptedId);
 let h=ctx.notice()+(owner?'<p><a href="#employment='+esc(id)+'">雇用・勤務へ戻る</a></p>':'')+'<h1>給与の振込先</h1>'+(owner?'<p>'+esc(d.staff.name)+' さん</p>':'<p class="small muted">口座情報は本人と塾だけが見られます。</p>');
 if(!owner&&step==='edit'){
  h+='<h2>本人名義の口座を入力</h2><p class="small">ゆうちょ銀行は記号・番号ではなく、他行からの振込用の店名・口座番号を入れます。7桁未満の口座番号は先頭に0を付けます。</p><form class="stack" autocomplete="off" data-form="bank-edit">';
  for(const [k,label] of fields){
   const v=draft?.[k]||'';
   h+='<label>'+esc(label)+(k==='accountType'?'<select name="'+k+'" required><option value="">選んでください</option>'+Object.entries(types).map(([value,name])=>'<option value="'+value+'"'+(v===value?' selected':'')+'>'+name+'</option>').join('')+'</select>':'<input name="'+k+'" value="'+esc(v)+'" maxlength="'+(k==='accountNumber'?7:k==='bankCode'?4:k==='branchCode'?3:k==='holderKana'?100:80)+'"'+(/Code|Number/.test(k)?' inputmode="numeric"':'')+(['bankCode','branchCode'].includes(k)?'':' required')+'>')+'</label>';
  }
  return h+'<button'+ctx.dis()+'>入力内容を確認する</button><button type="button" data-action="bank-cancel"'+ctx.dis()+'>入力をやめる</button></form>';
 }
 if(!owner&&step==='confirm'){
  h+='<h2>振込先と同意内容を確認</h2>'+accountHtml(ctx,draft,true)+'<form class="stack" data-form="bank-submit">'+box(ctx,'agree',d.consentText,agreed)+'<button class="primary"'+ctx.dis()+'>同意して振込先を提出する</button><button type="button" data-action="bank-edit-again"'+ctx.dis()+'>入力内容を修正する</button></form>';
  return h;
 }
 if(current)h+='<h2>現在の振込先</h2>'+record(ctx,current);else if(owner&&latest)h+='<p>確認済みの振込先はありません。</p>';
 if(latest&&latest.id!==d.acceptedId)h+='<h2>今回の提出</h2>'+record(ctx,latest)+(current?'<p>確認が終わるまでは、上の口座に振り込みます。</p>':'');
 if(!owner){
  h+='<button'+(latest?'':' class="primary"')+' data-action="bank-edit"'+ctx.dis()+'>'+(latest?'振込先を変更・再提出する':'振込先を登録する')+'</button>';
 }else if(latest?.status==='pending'){
  h+='<form class="stack" data-form="bank-accept">'+box(ctx,'confirm','口座情報の全文と本人の同意を確認し、この口座を給与の振込先として採用します',ownerConfirm)+'<button class="primary"'+ctx.dis()+'>確認して振込先に採用する</button></form><details><summary>修正をお願いする</summary><form class="stack" data-form="bank-return"><label>修正してほしい内容（口座番号は書かないでください）<textarea name="reason" required maxlength="200">'+esc(reason)+'</textarea></label><button'+ctx.dis()+'>修正を依頼する</button></form></details>';
 }else if(!latest)h+='<p>本人の登録待ちです。</p>';
 const old=d.requests.filter(r=>r.id!==d.latestId&&r.id!==d.acceptedId);
 if(old.length)h+='<details><summary>以前の提出・確認の履歴（'+old.length+'件）</summary>'+old.map(r=>record(ctx,r)).join('')+'</details>';
 return h;
}
export async function bankSubmit(ctx,kind,el){
 if(!kind.startsWith('bank-'))return false;
 const values=Object.fromEntries(new FormData(el));
 if(kind==='bank-edit'){draft=values;step='confirm';agreed=false;return true;}
 try{
  let r;
  if(kind==='bank-submit'){
   r=await ctx.call('employment/bank/submit',{version:cache.version,account:draft,consentVersion:cache.consentVersion,agree:el.elements.agree.checked});
  }else{
   const latest=cache.requests.find(r=>r.id===cache.latestId);
   r=await ctx.call('employment/bank/review',{staffId:cache.staff.id,version:cache.version,requestId:latest.id,hash:latest.contentHash,outcome:kind==='bank-accept'?'accepted':'returned',confirm:el.elements.confirm?.checked===true,reason:values.reason||''});
  }
  if(!r.ok){
   if(!ctx.handleAuth(r))ctx.say(r.error.message,'error');
   if(r.error?.code==='conflict'){cache=null;step='view';draft=null;agreed=false;ownerConfirm=false;reason='';}
   return true;
  }
  cache=r;step='view';draft=null;agreed=false;ownerConfirm=false;reason='';
  ctx.say(kind==='bank-submit'?'振込先を登録しました。確認が終わるまでお待ちください。':kind==='bank-accept'?'確認済みの振込先として保存しました。':'修正の依頼を記録しました。','ok');
 }catch{ctx.say('保存結果を確認できませんでした。画面を更新して提出状況を確認してください。','error');}
 return true;
}
export async function bankClick(ctx,action){
 if(!action.startsWith('bank-'))return false;
 if(action==='bank-edit'){const last=cache.requests.find(r=>r.id===cache.latestId);draft=last?{...last.account}:{};step='edit';agreed=false;}
 if(action==='bank-edit-again'){step='edit';agreed=false;}
 if(action==='bank-cancel'){step='view';draft=null;agreed=false;}
 return true;
}
