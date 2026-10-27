import { esc } from '/assets/v2/api.js';
// Groups match the server boundary; siblings, periods and approval states never merge.
// bare: 説明の文字（生徒・期間・状態）を付けず、ボタンだけ。生徒が複数のときは名前をボタンに（保護者の承認の画面）
export function agreementDocumentButtons(lines,{label='印刷・PDF保存',bare=false}={}) {
  const groups=new Map();
  for(const l of lines) {
    const k=JSON.stringify([l.studentId,l.startDate,l.endDate,l.status]);
    if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);
  }
  return [...groups.values()].map(ls=>{
    const l=ls[0], refs=ls.map(x=>({id:x.id,version:x.version}));
    const detail=(l.studentName?l.studentName+'・':'')+l.startDate+'〜'+l.endDate+'・'+({draft:'下書き',proposed:'案',approved:'控え',declined:'見送り'}[l.status]||'記録');
    if(bare)return '<button type="button" class="small-btn" data-action="agreement-doc" data-refs="'+esc(JSON.stringify(refs))+'">'+esc(groups.size>1&&l.studentName?l.studentName.split(' ').pop()+'の'+label:label)+'</button>';
    return '<p class="small"><button type="button" data-action="agreement-doc" data-refs="'+esc(JSON.stringify(refs))+'">'+esc(label)+'</button> '+esc(detail)+'</p>';
  }).join('');
}
// Reserve a tab synchronously from the click; keep unsaved inputs in the source page.
export function openAgreementDocument(request,onError) {
  const win=window.open('','_blank');
  if(!win){onError('書面のタブを開けませんでした。ポップアップを許可して、もう一度お試しください。');return;}
  win.opener=null;
  win.document.title='受講計画書を読み込み中';
  win.document.body.textContent='書面を読み込んでいます…';
  Promise.resolve().then(request).then(r=>{
    if(!r.ok)throw new Error(r.error?.message||'書面を開けませんでした');
    if(win.closed)return;
    const url=URL.createObjectURL(new Blob([r.html],{type:'text/html'}));
    win.location.replace(url);
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }).catch(e=>{if(!win.closed)win.close();onError(e.message||'通信できませんでした。もう一度お試しください。');});
}
