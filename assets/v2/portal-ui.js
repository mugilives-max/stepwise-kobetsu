import { automaticDeadline } from '/assets/v2/notice-view.js?v=20261016-notices';
import { invoiceDueText } from '/assets/v2/invoice-due.js?v=20261016-notices';
import { agreementDocumentButtons } from '/assets/v2/agreement-document.js?v=20261016-agreement';
// 保護者・生徒の画面で共通に使う部品（作り直し v2）。
// 考え方（docs/UX_STRUCTURE.md 1）: 一覧は白い枠に 1 件 1 行、操作は押すと下から出る画面で。文字より印で分かるように。
// - 授業の一覧（日付ごと）と、授業を押したときの画面（変更・お休み・キャンセルの連絡）
// - 宿題の一覧（左の丸を押して「できた」）
// - 授業の記録（1 件 1 枚。保護者への一言は目立たせる）
// - 受講合意書（月ごとに 1 枚。承認は月に 1 回）、請求、キャンセル料
// - テスト・行事
import { esc } from '/assets/v2/api.js';
import { mdw, endOf, STATUS, REQUEST, choiceOf, EVENT_KIND, eventForm } from '/assets/v2/schedule-view.js?v=20261016-notices';
import { hwText, hwSubject } from '/assets/v2/learning-view.js?v=20261008-launch1';
import { partText } from '/assets/v2/cancel-rate.js?v=20261008-launch1';
import { sheet, ICON } from '/staff/ui.js?v=20261008-launch1';
import { formOf, subjectGroups, subjectInfoHtml, formsText } from '/assets/v2/plan-view.js?v=20261020-r9';

export const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
export const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
export const monthLabel = m => `${Number(m.slice(5, 7))}月`;
export const given = name => String(name || '').split(' ').pop();
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const wd = d => WD[new Date(d + 'T00:00:00Z').getUTCDay()];
export const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
export { sheet, ICON };
export const PORTAL_ICON = {
  ...ICON,
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  book: '<path d="M4 6c2.5-1.2 5.3-1.2 8 .8 2.7-2 5.5-2 8-.8v12c-2.5-1.2-5.3-1.2-8 .8-2.7-2-5.5-2-8-.8z"/><path d="M12 6.8v12"/>',
  flag: '<path d="M6 21V4.5h10.5l-2 3.8 2 3.7H6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
export const picon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${PORTAL_ICON[k] || ''}</svg>`;
export const ibox = (k, color, label = '') => `<span class="ibox" style="background:${color}" role="img" aria-label="${esc(label)}">${picon(k)}</span>`;

// 日数の言い方（今日・明日・あと n 日）
export function daysText(date, today) {
  const n = Math.round((Date.parse(date) - Date.parse(today)) / 86400e3);
  return n === 0 ? '今日' : n === 1 ? '明日' : n > 1 ? `あと${n}日` : '';
}

// ---- 授業 ----
// まだ終わっていない授業か（日本時間）。今日の授業は、終わりの時刻までは「次の授業」に出し、終わったら次の授業に移す
export const notOver = (l, today) => l.date > today || (l.date === today && (!l.minutes || endOf(l.start, l.minutes) > new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16)));
const openRequest = l => (l.requests || []).find(r => r.status === 'open');
const statusText = l => {
  const r = openRequest(l);
  if (r) return [`<span class="tag ${r.kind === 'cancel' ? 'danger' : 'warn'}">${REQUEST[r.kind]}・先生の返事待ち</span>`];
  const [cls, label] = STATUS[l.status] || ['gray', l.status];
  const t = [];
  // 調整中（相談中・締め切りなし）と確認待ち（「この日程で大丈夫」か締め切りで確定）
  if (l.status === 'proposed') t.push(l.asked ? `<span class="tag ask">確認待ち${automaticDeadline(l) ? '・' + md(l.confirmBy) + 'まで' : '・ご返事が必要'}</span>` : '<span class="tag warn">調整中</span>');
  else if (l.status !== 'decided') t.push(`<span class="tag ${cls}">${label}</span>`);
  return t;
};
// 日付ごとにまとめた授業の一覧（白い枠）。行を押すと data-action="lesson" で下から出る画面
export function lessonRows(lessons, { names = {}, today = '', emptyText = 'これからの授業はありません。', bare = false } = {}) {
  if (!lessons.length) return bare ? '' : `<p class="muted small">${emptyText}</p>`;
  let h = '', last = '';
  for (const l of lessons) {
    if (l.date !== last && !bare) { if (last) h += '</div>'; h += `<div class="day-head2${l.date === today ? ' today' : ''}">${mdw(l.date)}${l.date === today ? '<small>今日</small>' : ''}</div><div class="group">`; last = l.date; }
    const faded = ['rested', 'cancelled'].includes(l.status);
    h += `<button type="button" class="lrow pl${faded ? ' faded' : ''}" data-action="lesson" data-id="${esc(l.id)}"><span class="t">${l.start}<small>〜${endOf(l.start, l.minutes)}</small></span>
      <span class="b"><span class="nm">${names[l.studentId] ? `<b>${esc(given(names[l.studentId]))}</b> ` : ''}${esc(l.subject)}${l.kind && l.kind !== '通常' ? `<small>（${esc(l.kind)}）</small>` : ''}${l.deliveryMode === 'online' ? '<small class="muted">・オンライン</small>' : ''}</span>
      <span class="tags">${statusText(l).join('')}</span></span><span class="go">›</span></button>`;
  }
  return bare ? h : h + '</div>';
}
// 予定表の「選んだ日」の 1 日分: テスト・行事と授業を 1 つの白い枠に
export function dayRows(date, lessons, events, { names = {}, canDelete = () => false } = {}) {
  const ls = lessons.filter(l => l.date === date).sort((a, b) => a.start.localeCompare(b.start)), evs = events.filter(e => e.date <= date && date <= e.dateTo);
  if (!ls.length && !evs.length) return '<p class="muted small" style="margin:4px 2px 10px">予定はありません。</p>';
  return '<div class="group">' + evs.map(e => `<div class="evrow"><span class="t"><small>${e.start ? e.start + '〜' + e.end : '終日'}</small></span><span class="b"><span class="nm">${esc(e.title || EVENT_KIND[e.kind])}</span><small>${names[e.studentId] ? esc(given(names[e.studentId])) + '・' : ''}${EVENT_KIND[e.kind]}</small></span>${canDelete(e) ? `<button type="button" class="x" data-action="del-event" data-id="${esc(e.id)}" aria-label="消す">${picon('x')}</button>` : '<span></span>'}</div>`).join('') + lessonRows(ls, { names, bare: true }) + '</div>';
}
// 次の授業（ホームの一番上）。押すと同じ下から出る画面
export function nextLessonHero(l, { names = {}, today = '' } = {}) {
  if (!l) return '<div class="hero empty"><span class="k">次の授業</span><strong>まだ決まっていません</strong></div>';
  const when = daysText(l.date, today);
  return `<button type="button" class="hero" data-action="lesson" data-id="${esc(l.id)}"><span class="k">次の授業${when ? `<b>${when}</b>` : ''}</span>
    <strong>${md(l.date)}<small>（${wd(l.date)}）</small> ${l.start}<small>〜${endOf(l.start, l.minutes)}</small></strong>
    <span class="s">${names[l.studentId] ? esc(given(names[l.studentId])) + '　' : ''}${esc(l.subject)}${l.deliveryMode === 'online' ? '・オンライン' : '・教室'}${l.status === 'proposed' ? (l.asked ? '<span class="tag ask">確認待ち</span>' : '<span class="tag warn">調整中</span>') : ''}</span></button>`;
}
// 授業を押したときの画面。state: { id, pick, note }。canRequest=false なら見るだけ。canAgree: 確認待ちに「この日程で大丈夫」を出す（保護者だけ）
export function lessonSheet(l, state, { names = {}, canRequest = true, canAgree = false, busy = false, sendLabel = '連絡する' } = {}) {
  const title = `${mdw(l.date)} ${l.start}〜${endOf(l.start, l.minutes)}`;
  const req = openRequest(l);
  let body = `<div class="ls-head"><strong>${names[l.studentId] ? esc(names[l.studentId]) + '　' : ''}${esc(l.subject)}${l.kind && l.kind !== '通常' ? `（${esc(l.kind)}）` : ''}</strong><span class="small muted">${l.deliveryMode === 'online' ? 'オンライン' : '教室で'}${l.minutes ? `・${l.minutes}分` : ''}</span><span class="tags">${statusText(l).join('') || '<span class="tag">確定</span>'}</span></div>`;
  if (l.status === 'proposed') body += `<p class="small muted" style="margin:0 0 8px">${l.asked ? (automaticDeadline(l) ? `先生から日程の確認のお願いです。${md(l.confirmBy)}までにご連絡がなければ、この日時で確定します。` : '先生から日程の確認のお願いです。この授業は無回答では確定しません。ご返事をいただいてから確定します。') : '先生と日時を相談している段階です。まだ確定していません（自動では確定しません）。'}</p>`;
  if (l.meetUrl && l.status === 'decided') body += `<a class="btn wide" href="${esc(l.meetUrl)}" target="_blank" rel="noopener">${picon('video')} Meet に参加する</a>`;
  if (req) {
    body += `<div class="ls-req"><div><b>${REQUEST[req.kind]}</b>を連絡済みです${req.note ? `<div class="small muted">${esc(req.note)}</div>` : ''}<div class="small muted">先生の返事をお待ちください。</div></div>${canRequest ? `<button data-action="withdraw" data-id="${esc(req.id)}"${busy ? ' disabled' : ''}>連絡を取り下げる</button>` : ''}</div>`;
    return sheet(esc, title, body, 'close-sheet');
  }
  if (canAgree && canRequest && l.status === 'proposed' && l.asked) body += `<div style="margin:0 0 10px"><button class="primary wide" data-action="agree" data-id="${esc(l.id)}" data-version="${l.version}"${busy ? ' disabled' : ''}>この日程で大丈夫</button><p class="small muted" style="margin:4px 0 0">押すと、この日時で確定します（予約になります）。</p></div>`;
  const choices = canRequest ? (l.choices || []) : [];
  if (!choices.length) {
    body += `<p class="small muted">${!canRequest ? '予定の変更・お休みの連絡は、保護者の方からお願いします。' : ['rested', 'cancelled', 'done'].includes(l.status) ? 'この授業は' + (STATUS[l.status] || [])[1] + 'です。' : '授業が始まっているため、ここからは連絡できません。先生に直接お知らせください。'}</p>`;
    return sheet(esc, title, body, 'close-sheet');
  }
  body += `<h3>連絡する</h3><div class="choice-list">` + choices.map(c => { const [label, cost, how] = choiceOf(l, c); const on = state.pick === c;
    return `<button type="button" class="choice${on ? ' on' : ''}${c === 'cancel' ? ' danger' : ''}" data-action="pick" data-c="${c}" aria-pressed="${on}"><span class="b"><b>${esc(label)}</b>${on ? `<small>${esc(how)}</small>` : ''}</span><span class="cost">${esc(cost)}</span></button>`; }).join('') + '</div>';
  if (state.pick) {
    const offerRest = state.pick === 'rest' && l.status === 'proposed';
    body += offerRest ? '<p class="small muted">この授業（まだ確定していません）をお休みにします。料金はかかりません。</p>' : `<input id="change-note" maxlength="500" value="${esc(state.note || '')}" placeholder="${esc(choiceOf(l, state.pick)[3])}" autocomplete="off">`;
    body += `<div class="row" style="margin-top:10px"><button class="${state.pick === 'cancel' ? 'danger' : 'primary'} wide" data-action="send-change"${busy ? ' disabled' : ''}>${busy ? '送っています…' : sendLabel}</button></div>`;
  }
  return sheet(esc, title, body, 'close-sheet');
}

// ---- 宿題 ----
// 1 件 1 行。左の丸を押して「できた」。先生が確認すると緑の ✓
export function homeworkRows(list, { names = {}, canReport = true, emptyText = '今やる宿題はありません。' } = {}) {
  if (!list.length) return `<p class="muted small">${emptyText}</p>`;
  return '<div class="group">' + list.map(w => {
    const st = w.status, sub = hwSubject(w);
    const due = w.dueMode === 'none' ? '' : w.due ? `${md(w.due)}(${wd(w.due)})まで` : w.dueMode === 'nextLesson' ? '次の授業まで' : '';
    const check = w.checkResult === 'partial' && st === 'open' ? '<span class="tag warn">前回は一部だけ</span>' : w.checkResult === 'notDone' && st === 'open' ? '<span class="tag danger">前回はできていない</span>' : '';
    const btn = st === 'confirmed' ? `<span class="hw-dot done" role="img" aria-label="先生が確認しました">${picon('check')}</span>`
      : !canReport ? `<span class="hw-dot${st === 'reported' ? ' on' : ''}" role="img" aria-label="${st === 'reported' ? 'できたと報告済み' : '未完了'}">${st === 'reported' ? picon('check') : ''}</span>`
      : st === 'reported' ? `<button type="button" class="hw-dot on" data-action="hw-undo" data-id="${esc(w.id)}" aria-label="できたの報告を取り消す">${picon('check')}</button>`
      : `<button type="button" class="hw-dot" data-action="hw-done" data-id="${esc(w.id)}" aria-label="できた"></button>`;
    return `<div class="hw${st !== 'open' ? ' ' + st : ''}">${btn}<span class="b"><span class="nm">${esc(hwText(w))}</span><small>${names[w.studentId] ? esc(given(names[w.studentId])) + '・' : ''}${sub ? esc(sub) + '・' : ''}${esc(due)}${st === 'reported' ? '・先生の確認待ち' : ''}${check ? ' ' + check : ''}${w.reviewNote && st === 'open' ? `<span class="note">先生から: ${esc(w.reviewNote)}</span>` : ''}</small></span></div>`;
  }).join('') + '</div>';
}

// ---- 授業の記録（1 件 1 枚） ----
const CHECK_TEXT = { done: ['ok', 'やってきた'], partial: ['warn', '一部だけ'], notDone: ['danger', 'やってこなかった'] };
export function recordCards(records, homework = [], { names = {}, limit = 0 } = {}) {
  const list = limit ? records.slice(0, limit) : records;
  if (!list.length) return '<p class="muted small">公開された授業の記録はまだありません。</p>';
  return list.map(r => {
    const checks = homework.filter(w => w.checkedRecordId === r.id && CHECK_TEXT[w.checkResult]);
    return `<article class="rcard"><div class="rc-head"><strong>${md(r.date)}<small>（${wd(r.date)}）</small> ${esc(r.subject)}${r.kind && r.kind !== '通常' ? `<small>（${esc(r.kind)}）</small>` : ''}</strong>${names[r.studentId] ? `<span class="tag gray">${esc(given(names[r.studentId]))}</span>` : ''}</div>
      ${r.range ? `<div class="rc-line">${ibox('book', '#2f6fde', '扱った範囲')}<span>${esc(r.range)}</span></div>` : ''}
      ${r.comment ? `<div class="rc-line">${ibox('comment', '#5b6672', '授業の様子')}<span class="pre">${esc(r.comment)}</span></div>` : ''}
      ${r.parentMessage ? `<div class="rc-line pm">${ibox('parent', '#138a8a', '保護者の方へ')}<span class="pre"><b>保護者の方へ</b>${esc(r.parentMessage)}</span></div>` : ''}
      ${checks.length ? `<div class="rc-line">${ibox('homework', '#7b4fd6', '宿題のチェック')}<span class="chk-list">${checks.map(w => `<span>${esc(hwText(w))} <span class="tag ${CHECK_TEXT[w.checkResult][0]}">${CHECK_TEXT[w.checkResult][1]}</span></span>`).join('')}</span></div>` : ''}
    </article>`;
  }).join('');
}

// ---- 受講合意書（月ごとに 1 枚） ----
const planMonth = l => l.startDate.slice(0, 7);
const groupByMonth = lines => { const m = new Map(); for (const l of lines) { const k = planMonth(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); } return [...m.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1); };
const lineLabel = (l, multi) => `${multi ? `<b>${esc(given(l.studentName))}</b> ` : ''}${esc(l.subject)}${l.kind !== '通常' ? `（${esc(l.kind)}）` : ''}${l.parentId ? ' <span class="tag">追加</span>' : ''}${l.comment ? `<small class="muted">${esc(l.comment)}</small>` : ''}`;
const period = l => l.startDate.slice(8) === '01' && Number(l.endDate.slice(8)) >= 28 && l.startDate.slice(0, 7) === l.endDate.slice(0, 7) ? '' : `${md(l.startDate)}〜${md(l.endDate)}`;
// 科目ごとのまとまり（assets/v2/plan-view.js。管理画面のプレビューと同じまとめ方）。兄弟がいるときは 生徒＋科目。
// 中に 説明・目的ごとの回数、そのあとに行（授業・演習を言葉で）。lineHtml(l) は行の HTML（回数の選択などはそのまま）
const formLabel = l => { const f = formOf(l.kind); return `<span><span class="tag">${esc(f.form)}</span>${f.detail ? ` <span class="tag gray">${esc(f.detail)}</span>` : ''}${l.parentId ? ' <span class="tag">追加</span>' : ''}</span>`; };
const planSubjects = (lines, multi, lineHtml) => subjectGroups(lines, l => (multi ? l.studentId + '|' : '') + l.subject).map(g =>
  `<div class="pl-subj"><div class="pl-subj-head"><strong>${multi ? esc(given(g.lines[0].studentName)) + ' ' : ''}${esc(g.subject)}</strong><small>${esc(formsText(g.forms))}</small></div>${subjectInfoHtml(g, esc)}${g.lines.map(lineHtml).join('')}</div>`).join('');
// 承認をお願いしている月。counts: { [lineId]: 承認する回数 }（画面で変えた値）
export function planApprovalCard(month, lines, { multi, counts = {}, dis = '', consenterName = '' }) {
  const n = l => counts[l.id] === undefined ? l.count : counts[l.id];
  const total = lines.reduce((s, l) => s + n(l) * l.fee, 0);
  const rows = planSubjects(lines, multi, l => `<div class="pl"><span class="b">${formLabel(l)}${period(l) ? `<small class="muted">${period(l)}</small>` : ''}</span>
      <span class="n"><select name="count-${esc(l.id)}" data-plan-count="${esc(l.id)}" aria-label="回数">${Array.from({ length: l.count - l.minCount + 1 }, (_, i) => l.count - i).map(k => `<option value="${k}"${n(l) === k ? ' selected' : ''}>${k}回</option>`).join('')}${l.minCount === 0 ? `<option value="0"${n(l) === 0 ? ' selected' : ''}>見送る</option>` : ''}</select><small>1回 ${esc(l.minutes)}分・${yen(l.fee)}</small></span>
      <span class="amt">${yen(n(l) * l.fee)}</span></div>${l.minCount ? `<div class="small muted pl-note">すでに決まっている授業が${l.minCount}回あるため、${l.minCount}回より少なくはできません。</div>` : ''}`);
  return `<form class="pcard ask" data-form="plan-approve" data-refs="${esc(JSON.stringify(lines.map(l=>({id:l.id,version:l.version}))))}" data-month="${esc(month)}"><div class="pc-head"><strong>${monthLabel(month)}の受講合意書（案）</strong><span class="tag warn">承認をお願いします</span></div>
    <div class="pl-list">${rows}</div><div class="pc-total"><span>合計（見込み）</span><strong>${yen(total)}</strong></div>
    <p class="small muted">回数を減らしたいときは、各行の回数を変えてから承認してください。承認は、表示した科目・回数・時間・料金の範囲で授業を実施できるようにするものです。予約や授業料の事前購入ではありません。授業日時は別に確認します。</p>
    ${agreementDocumentButtons(lines,{label:'提示された案を印刷・PDF保存'})}<p class="small muted">書面には提示された回数を表示します。画面で変更中の回数は、承認後の控えに反映されます。</p>
    ${consenterField(month, consenterName)}<button class="primary wide"${dis}>この内容で承認する</button></form>`;
}
// 先生が記録した承諾（LINE など）を確かめてもらう月
export function planAckCard(month, lines, { multi, dis = '' }) {
  const via = lines[0].approvedVia, date = lines[0].consentDate;
  const rows = planSubjects(lines, multi, l => `<div class="pl"><span class="b">${formLabel(l)}${period(l) ? `<small class="muted">${period(l)}</small>` : ''}</span><span class="n"><small>${l.approvedCount}回・1回 ${yen(l.fee)}</small></span><span class="amt">${yen(l.approvedCount * l.fee)}</span></div>`);
  const total = lines.reduce((s, l) => s + l.approvedCount * l.fee, 0);
  return `<div class="pcard ack" data-month="${esc(month)}"><div class="pc-head"><strong>${monthLabel(month)}の受講合意書</strong><span class="tag">確かめてください</span></div>
    <p class="small muted">${esc(via)}で承諾いただいた内容を、先生が記録しました（${esc(date)}）。</p>
    <div class="pl-list">${rows}</div><div class="pc-total"><span>合計（見込み）</span><strong>${yen(total)}</strong></div>
    ${agreementDocumentButtons(lines)}<div class="row"><button class="primary" data-action="plan-ack-month" data-refs="${esc(JSON.stringify(lines.map(l=>({id:l.id,version:l.version}))))}" data-month="${esc(month)}"${dis}>この内容で合っています</button><button data-action="plan-inquiry" data-refs="${esc(JSON.stringify(lines.map(l=>({id:l.id,version:l.version}))))}" data-month="${esc(month)}"${dis}>違うところがある</button></div></div>`;
}
// 決まった計画の一覧（月ごと）
export function planHistory(lines, { multi }) {
  const groups = groupByMonth(lines);
  if (!groups.length) return '';
  return '<div class="group">' + groups.map(([m, ls]) => {
    const total = ls.reduce((s, l) => s + (l.status === 'approved' ? l.approvedCount * l.fee : 0), 0);
    return `<details class="ph"><summary><span class="b"><b>${monthLabel(m)}</b><small>${ls.map(l => `${multi ? given(l.studentName) + ' ' : ''}${l.subject}${l.status === 'approved' ? ` ${l.approvedCount}回` : '（見送り）'}`).map(esc).join('・')}</small></span><span class="amt">${yen(total)}</span></summary>
      <div class="pl-list">${planSubjects(ls, multi, l => `<div class="pl"><span class="b">${formLabel(l)}${period(l) ? `<small class="muted">${period(l)}</small>` : ''}</span><span class="n"><small>${l.status === 'approved' ? `${l.approvedCount}回・1回 ${yen(l.fee)}<br>${esc(l.consentDate)}・${esc(l.approvedVia)}${l.familyAck === 'inquiry' ? '・問い合わせ中' : ''}` : '見送り'}</small></span><span class="amt">${l.status === 'approved' ? yen(l.approvedCount * l.fee) : ''}</span></div>`)}</div>${agreementDocumentButtons(ls)}</details>`;
  }).join('') + '</div>';
}
export function planGroups(plans) {
  const asks = plans.filter(l => l.status === 'proposed'), acks = plans.filter(l => l.status === 'approved' && l.approvedBy === 'staff' && !l.familyAck);
  const others = plans.filter(l => !asks.includes(l) && !acks.includes(l));
  return { asks: groupByMonth(asks), acks: groupByMonth(acks), others };
}
export const inquirySheet = (month, note, busy) => sheet(esc, `${monthLabel(month)}の受講合意書について`, `<p class="small muted">違うところや確かめたいことを書いてください。先生に届きます。</p><textarea id="inquiry-note" rows="3" maxlength="500" placeholder="例: 英語は 4 回ではなく 3 回で話していました">${esc(note || '')}</textarea><div class="row" style="margin-top:10px"><button class="primary wide" data-action="send-inquiry" data-month="${esc(month)}"${busy ? ' disabled' : ''}>${busy ? '送っています…' : '先生に伝える'}</button></div>`, 'close-sheet');

// ---- 受講規約（同意が要るとき） ----
export function termsCard(terms, { busy = false, checked = false, consenterName = '' } = {}) {
  const t = terms.current;
  return `<div class="pcard ask" data-terms="${esc(t.version)}"><div class="pc-head"><strong>${esc(t.title || '受講規約')}</strong><span class="tag warn">同意をお願いします</span></div>
    <p class="small">${t.from ? `${esc(t.from)} から適用されます。` : ''}${t.note ? esc(t.note) : '受講合意書を承認する前に、受講規約をお読みください。'}${terms.agreed.version ? `<br><span class="muted">前の版（${esc(terms.agreed.version)}）には同意いただいています。</span>` : ''}</p>
    ${t.url ? `<a class="btn wide" href="${esc(t.url)}" target="_blank" rel="noopener">${picon('file')} 規約の全文を読む</a>` : '<p class="small muted">全文は教室からお渡しします。</p>'}
    ${consenterField('terms', consenterName)}<label class="agree"><input type="checkbox" id="terms-agree"${checked ? ' checked' : ''}> 全文を読み、内容に同意します</label>
    <button class="primary wide" data-action="terms-accept" data-version="${esc(t.version)}"${busy ? ' disabled' : ''}>同意する</button></div>`;
}
// 受講条件書（規約 第2条の受講条件書）: 同意をお願いするカードと、同意済みの 1 行
const condRow = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
const monthJa = m => m ? `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月` : '';
export function conditionCard(x, { busy = false, checked = false, consenterName = '' } = {}) {
  const c = x.latest;
  return `<div class="pcard ask" data-condition="${esc(c.id)}"><div class="pc-head"><strong>${esc(given(x.studentName))}さんの受講条件書（第${c.no}版）</strong><span class="tag warn">同意をお願いします</span></div>
    <dl class="cond-dl">${condRow('通常の基準単価', `1回 ${c.minutes}分 <strong>${yen(c.fee)}</strong>（税込）`)}${condRow('形式', esc(c.deliveryLabel))}${condRow('人数', esc(c.groupSize))}${condRow('生徒本人からの連絡', c.studentContact ? '前日23時までの無料のお休みは、本人からも連絡できます' : '保護者からお願いします')}${condRow('科目', esc(c.subjects))}${condRow('特記事項', esc(c.note))}${condRow('適用開始', monthJa(c.fromMonth))}</dl>
    ${x.agreed ? `<p class="small muted">今は第${x.agreed.no}版（1回 ${x.agreed.minutes}分 ${yen(x.agreed.fee)}）に同意いただいています。この版に同意すると、${monthJa(c.fromMonth)}から置き換わります。</p>` : '<p class="small muted">通常の授業はこの条件で行います。月ごとの回数は、別に受講合意書でお知らせします。</p>'}
    ${c.docFileId ? `<button type="button" class="btn wide" data-action="gr-open" data-id="${esc(c.docFileId)}">${picon('file')} 受講条件書（書面）を開く</button>` : ''}
    ${consenterField(c.id, consenterName)}<label class="agree"><input type="checkbox" data-cond-agree="${esc(c.id)}"${checked ? ' checked' : ''}> 内容を確かめ、この条件に同意します</label>
    <button class="primary wide" data-action="cond-agree" data-id="${esc(c.id)}"${busy ? ' disabled' : ''}>同意する</button></div>`;
}
export const conditionLine = items => (items || []).filter(x => x.agreed && !x.needs).map(x => `<p class="small muted">${esc(given(x.studentName))}さんの受講条件書 第${x.agreed.no}版に同意済み（${esc(String(x.agreed.agreedAt).slice(0, 10))}）・1回 ${x.agreed.minutes}分 ${yen(x.agreed.fee)}・${esc(x.agreed.deliveryLabel)}${x.agreed.docFileId ? `　<button type="button" class="linkish" data-action="gr-open" data-id="${esc(x.agreed.docFileId)}">条件書を開く</button>` : ''}</p>`).join('');
// 特別単価合意書の承認（規約 第6条）: 承認をお願いするカードと、承認済みの 1 行
const ymdJa = v => v ? `${Number(v.slice(0, 4))}年${Number(v.slice(5, 7))}月${Number(v.slice(8))}日` : '';
export function specialCard(x, { busy = false, checked = false, consenterName = '' } = {}) {
  return `<div class="pcard ask" data-special="${esc(x.id)}"><div class="pc-head"><strong>${esc(given(x.studentName))}さんの特別単価「${esc(x.title)}」</strong><span class="tag warn">承認をお願いします</span></div>
    <dl class="cond-dl">${condRow('指導の目的', esc(x.purpose))}${condRow('内容と範囲', esc(x.content).replace(/\n/g, '<br>'))}${condRow('通常の授業との違い', esc(x.reason).replace(/\n/g, '<br>'))}${condRow('必要な準備', esc(x.prep))}${condRow('1回の時間と特別の基準単価', `${x.minutes}分 <strong>${yen(x.fee)}</strong>（税込）`)}${condRow('対象期間', `${ymdJa(x.fromDate)} 〜 ${ymdJa(x.toDate)}`)}${condRow('特記事項', esc(x.note))}</dl>
    <p class="small muted">承認すると、この期間の受講合意書の案に種類「${esc(x.title)}」として、この基準単価を上限とした適用単価で提案できます。月ごとの回数は受講合意書で別に承認していただきます。</p>
    ${x.docFileId ? `<button type="button" class="btn wide" data-action="gr-open" data-id="${esc(x.docFileId)}">${picon('file')} 特別単価合意書（書面）を開く</button>` : ''}
    ${consenterField(x.id, consenterName)}<label class="agree"><input type="checkbox" data-special-agree="${esc(x.id)}"${checked ? ' checked' : ''}> 内容を確かめ、この特別単価と料金を承認します</label>
    <button class="primary wide" data-action="special-agree" data-id="${esc(x.id)}"${busy ? ' disabled' : ''}>承認する</button></div>`;
}
export const specialLine = items => (items || []).filter(x => x.status === 'agreed').map(x => `<p class="small muted">${esc(given(x.studentName))}さんの特別単価「${esc(x.title)}」承認済み（${esc(String(x.agreedAt).slice(0, 10))}）・${x.minutes}分 ${yen(x.fee)}・${ymdJa(x.fromDate)}〜${ymdJa(x.toDate)}${x.docFileId ? `　<button type="button" class="linkish" data-action="gr-open" data-id="${esc(x.docFileId)}">条件書を開く</button>` : ''}</p>`).join('');
export const termsLine = terms => terms && terms.agreed.version ? `<p class="small muted">受講規約 ${esc(terms.agreed.version)} に同意済み（${esc(String(terms.agreed.at).slice(0, 10))}）${terms.agreed.url ? `・<a href="${esc(terms.agreed.url)}" target="_blank" rel="noopener">同意した版の全文</a>` : ''}</p>` : '';

// ---- 請求 ----
const INV = { confirmed: ['お支払い待ち', 'warn'], reported: ['入金の確認待ち', ''], paid: ['お支払い済み', 'ok'], void: ['取り消し済み', ''] };
export function invoiceRows(invoices) {
  if (!invoices.length) return '<p class="muted small">まだ請求はありません。実施した授業の分を、翌月3日に確定してお知らせします。</p>';
  return '<div class="group">' + invoices.map(v => { const [label, cls] = INV[v.status] || [v.status, ''];
    return `<button type="button" class="irow" data-action="invoice" data-id="${esc(v.id)}"><span class="b"><b>${v.month.slice(0, 4)}年${monthLabel(v.month)}分</b><small><span class="tag ${cls}">${label}</span>${v.status === 'paid' && v.paidOn ? ` ${md(v.paidOn)}` : ''}</small></span><span class="amt">${yen(v.total)}</span><span class="go">›</span></button>`; }).join('') + '</div>';
}
export function invoiceSheet(v, { multi, busy = false }) {
  const [label, cls] = INV[v.status] || [v.status, ''], by = {};
  for (const i of v.items) (by[i.studentName] = by[i.studentName] || []).push(i);
  let body = `<div class="inv-total"><span class="tag ${cls}">${label}</span><strong>${yen(v.total)}</strong></div>`;
  if(v.status==='void')body+='<p class="notice">この請求は取り消されています。お支払いは不要です。理由：'+esc(v.voidReason||'')+'<br>お振込み済みの場合は教室へご連絡ください。</p>';
  else if(v.status!=='paid')body+='<p><b>支払期限：'+esc(v.dueText||invoiceDueText(v))+'</b></p><p>振込先：'+esc(v.bank||'請求書をご確認ください。未記載の場合は教室から別途ご案内します。')+'</p><p class="small">振込手数料は保護者のご負担となります。</p>';
  body += Object.entries(by).map(([name, items]) => `${multi ? `<h3>${esc(name)}</h3>` : ''}<table class="itbl">${items.map(i => `<tr><td>${i.date ? md(i.date) : ''}</td><td>${esc(i.subject)}${i.label ? `<small class="muted"> ${esc(i.label)}</small>` : ''}</td><td class="r">${i.kind === 'lesson' && i.minutes ? i.minutes + '分' : ''}</td><td class="r">${yen(i.amount)}</td></tr>`).join('')}</table>`).join('');
  if (v.invoiceDocId || v.receiptDocId) body += `<div class="row" style="margin:8px 0">${v.invoiceDocId ? `<button type="button" class="btn" data-action="gr-open" data-id="${esc(v.invoiceDocId)}">${picon('file')} 請求書を開く</button>` : ''}${v.receiptDocId ? `<button type="button" class="btn" data-action="gr-open" data-id="${esc(v.receiptDocId)}">${picon('file')} 領収書を開く</button>` : ''}</div>`;
  if (v.status === 'confirmed') body += `<p class="small muted">お振込のあと、下のボタンで知らせてください。先生が入金を確かめます。</p><button class="primary wide" data-action="inv-report" data-id="${esc(v.id)}" data-version="${v.version}"${busy ? ' disabled' : ''}>振り込みました</button>`;
  else if (v.status === 'reported') body += '<p class="small muted">振込のご連絡ありがとうございます。先生が入金を確かめます。</p>';
  else if (v.status === 'paid') body += `<p class="small muted">入金を確認しました（${esc(v.paidOn)}）。ありがとうございました。</p>`;
  return sheet(esc, `${v.month.slice(0, 4)}年${monthLabel(v.month)}分の授業料`, body, 'close-sheet');
}

// ---- キャンセル料 ----
export function feeRows(fees, { multi }) {
  if (!fees.length) return '';
  return '<div class="group">' + fees.map(f => `<button type="button" class="irow" data-action="fee" data-id="${esc(f.id)}"><span class="b"><b>${md(f.date)} ${esc(f.start)} ${multi ? esc(given(f.studentName)) + ' ' : ''}${esc(f.subject)}</b><small>${f.invoiceId ? '請求済み' : f.reliefStatus === 'pending' ? '減額・免除を申請中' : f.reliefStatus ? '申請に回答あり' : '次の請求に入ります'}</small></span><span class="amt">${yen(f.amount)}</span><span class="go">›</span></button>`).join('') + '</div>';
}
export function feeSheet(f, { busy = false, note = '' }) {
  let body = `<div class="inv-total"><span class="small muted">${(f.parts || []).length ? f.parts.map(p => esc(partText(p, f.date))).join('<br>') : 'キャンセル料'}</span><strong>${yen(f.amount)}</strong></div>`;
  if (f.note) body += `<p class="small muted">${esc(f.note)}</p>`;
  if (f.reliefStatus === 'pending') body += '<p class="small">減額・免除の申請を受け付けました。先生からの回答をお待ちください。</p>';
  else if (f.reliefStatus) body += `<p class="small">申請への回答: ${esc(f.reliefResponse)}</p>`;
  else if (!f.invoiceId && f.amount > 0) body += `<h3>減額・免除を申請する</h3><p class="small muted">重篤な体調不良で受診した場合や電車の運休など、やむを得ない事情のときに申請できます。通常の体調不良は対象外です。</p><textarea id="relief-note" rows="2" maxlength="1000" placeholder="事情を書いてください（例: 利用予定の路線が運休したため）">${esc(note)}</textarea><div class="row" style="margin-top:10px"><button class="primary wide" data-action="send-relief" data-id="${esc(f.id)}" data-version="${f.version}"${busy ? ' disabled' : ''}>${busy ? '送っています…' : '申請する'}</button></div>`;
  return sheet(esc, `${mdw(f.date)} ${esc(f.subject)} のキャンセル料`, body, 'close-sheet');
}

// ---- テスト・行事 ----
export function eventRows(events, { names = {}, canDelete = () => false, today = '' } = {}) {
  if (!events.length) return '<p class="muted small">知らせた予定はありません。</p>';
  return '<div class="group">' + events.map(e => `<div class="evrow"><span class="t">${md(e.date)}<small>${wd(e.date)}${e.dateTo !== e.date ? '〜' + md(e.dateTo) : ''}</small></span><span class="b"><span class="nm">${esc(e.title || EVENT_KIND[e.kind])}</span><small>${names[e.studentId] ? esc(given(names[e.studentId])) + '・' : ''}${EVENT_KIND[e.kind]}${e.start ? '・' + e.start + '〜' + e.end : ''}${e.date >= today && daysText(e.date, today) ? '・' + daysText(e.date, today) : ''}</small></span>${canDelete(e) ? `<button type="button" class="x" data-action="del-event" data-id="${esc(e.id)}" aria-label="消す">${picon('x')}</button>` : '<span></span>'}</div>`).join('') + '</div>';
}
export const eventSheet = students => sheet(esc, 'テスト・行事を知らせる', `<p class="small muted">テスト・行事・授業ができない日を知らせると、先生が予定を作るときの参考にします。</p>${eventForm(students)}`, 'close-sheet');

// 下から出る画面の共通の動き: Esc で閉じる、閉じるときは滑って戻る（スタッフの画面と同じ）
export function wireSheets(app, { reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { const x = app.querySelector('.bsheet-head button.icon'); if (x) x.click(); } });
  let pass = false;
  document.addEventListener('click', ev => {
    if (pass || reduced()) return;
    const closer = ev.target.closest('.overlay, .bsheet-head [data-action]'); if (!closer) return;
    const box = document.querySelector('.bsheet'); if (!box) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    box.classList.add('closing'); document.querySelectorAll('.overlay').forEach(o => o.classList.add('closing'));
    setTimeout(() => { pass = true; closer.click(); pass = false; }, 210);
  }, true);
}
// 描き直しても開いている下から出る画面は動かさない（中のスクロールも保つ）
export function keepSheet(app, draw) {
  const was = app.querySelector('.bsheet'), label = was && was.getAttribute('aria-label'), top = was ? was.scrollTop : 0;
  draw();
  const now = app.querySelector('.bsheet');
  if (now && label === now.getAttribute('aria-label')) { now.classList.add('still'); now.scrollTop = top; }
}

const consentTime = value => {
  if (!value) return '記録なし';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return esc(value) + '（時刻の記録なし）';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? esc(d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })) + '（日本時間）' : esc(value);
};
const evidenceText = (r, at) => `承認者：${esc(r.consenterName || '記録なし')}<br>承認日時：${consentTime(at)}<br>経路：${esc(r.via || r.agreedVia || r.approvedVia || '記録なし')}<br>記録日時：${consentTime(r.recordedAt)}・記録者：${esc(r.recordedByName || '記録なし')}`;
export function contractArchive(data) {
  if (!data) return '';
  if (data.loading) return '<p class="small muted">契約・同意の控えを読み込んでいます…</p>';
  if (data.error) return `<p class="notice error">${esc(data.error)}</p>`;
  const doc = x => x.docFileId ? `<button type="button" class="linkish" data-action="gr-open" data-id="${esc(x.docFileId)}">当時の書面を開く</button>` : '<span class="muted">書面の記録なし</span>';
  const cs = (data.conditions?.items || []).flatMap(x => (x.history || []).map(c => ({...c,studentName:x.studentName})));
  const ss = [...(data.specials?.items || []), ...(data.specials?.past || [])];
  const terms = data.terms?.history || [];
  const status = {proposed:'提案',approved:'承認済み',declined:'見送り',agreed:'同意済み',replaced:'旧提案',ended:'終了'};
  const details = (name,rows) => '<details><summary>'+name+'（'+rows.length+'件）</summary>'+rows.join('')+'</details>';
  let h = '<section class="group" style="padding:12px"><h3>契約・同意の控え</h3><p class="small muted">過去の記録を表示しています。「記録なし」は当時の記録から確認できない項目です。下書きは表示しません。</p>';
  h += details('規約への同意', terms.map(r=>`<div class="pcard"><strong>${esc(r.version)}</strong><p class="small">${evidenceText(r,r.at)}</p>${/^https:\/\//.test(r.url||'') ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">この版の全文</a>` : '<p class="small muted">当時の全文リンクは未登録です。</p>'}</div>`));
  h += details('受講条件書',cs.map(c=>`<div class="pcard"><strong>${esc(c.studentName)}・第${c.no}版（${esc(status[c.status]||c.status)}）</strong><p class="small">${esc(c.fromMonth)}から・${c.minutes}分 ${yen(c.fee)}<br>${esc(c.subjects)}・${esc(c.deliveryLabel)}・${esc(c.groupSize)}<br>規約 ${esc(c.termsVersion || '記録なし')}</p><p class="small">${evidenceText(c,c.agreedAt)}</p>${doc(c)}</div>`));
  h += details('特別単価合意書',ss.map(c=>`<div class="pcard"><strong>${esc(c.studentName)}・${esc(c.title)} 第${c.no}版（${esc(status[c.status]||c.status)}）</strong><p class="small">${esc(c.fromDate)}〜${esc(c.toDate)}・${c.minutes}分 ${yen(c.fee)}<br>目的：${esc(c.purpose || '記録なし')}<br>規約 ${esc(c.termsVersion || '記録なし')}</p><p class="small">${evidenceText(c,c.agreedAt)}</p>${doc(c)}</div>`));
  h += details('受講合意書の履歴',(data.plans||[]).map(l=>{
    const cd=cs.find(c=>c.id===l.conditionId), sp=ss.find(c=>c.id===l.specialId);
    return `<div class="pcard"><strong>${esc(l.studentName)}・${esc(l.subject)} ${esc(l.kind)}（${esc(status[l.status]||l.status)}）</strong><p class="small">第${l.version}版・${esc(l.startDate)}〜${esc(l.endDate)}<br>${l.minutes}分・適用単価 ${yen(l.fee)}（税込）・提案 ${l.count}回${l.approvedCount==null?'':'・承認 '+l.approvedCount+'回'}<br>予定総額 ${yen((l.approvedCount ?? l.count)*l.fee)}<br>指導区分：${l.instructionType==='special'?'特別単価':l.instructionType==='regular'?'通常の単価':'記録なし'}<br>${esc(l.comment || '')}<br>規約 ${esc(l.termsVersion || '記録なし')}<br>受講条件書 ${cd?'第'+cd.no+'版':'記録なし'}・特別単価合意書 ${esc(sp?sp.title+' 第'+sp.no+'版':l.instructionType==='regular'?'該当なし':'記録なし')}<br>提案者：${esc(l.proposedByName || '記録なし')}・提案記録：${consentTime(l.proposedAt)}</p><p class="small">${evidenceText(l,l.consentedAt || l.consentDate)}</p>${agreementDocumentButtons([l],{label:'この版を印刷・PDF保存'})}</div>`;
  }));
  return h+'</section>';
}

const consenterField = (key,name) => `<label>承認・同意する保護者の氏名<input name="consenterName" data-consenter="${esc(key)}" maxlength="100" value="${esc(name)}" required autocomplete="name"></label>`;
