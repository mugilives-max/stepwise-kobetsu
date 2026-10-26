// 受講計画合意書の見せ方（管理画面・保護者画面の両方で使う。DOM を使わない。node のテストからも読む）
// 受講計画合意書の正本は planLines の 1 行（科目 × 種類 × 期間 × 回数 × 1回の時間・授業料）。ここでは行を変えず、読むためにまとめるだけ。
// - まとまり（set）: 生徒 × 正確な期間 × 状態。同じ月でも期間や状態が違えば別のまとまり（承認済みと下書きを一つにしない）
// - 科目（subject）: まとまりの中を科目ごとに。「授業 n回／演習 m回」は形（授業・演習・講習・その他）ごとに足す。
//   時間・授業料・種類が違う行は 1 行のまま残し、足し算は形ごとの回数と金額だけ（内訳はいつも行で読める）
// - 目的・教材（parts）: 行ごとの任意の内訳 [{ label, count }]。自由記述（説明）から数を読み取ることはしない。
//   内訳の合計が行の回数より少なければ「内訳なし」、多ければ「内訳が回数を超えています」と出す（隠さない）
// - 金額: 行ごとに 回数 × 1回の授業料（承認済みは承認した回数、見送りは 0 回）。授業料が数でない行は「算出できない」として合計を「一部だけ」にする
// 種類（kind）と形の対応: 「通常」と「基礎の授業」「発展の授業」は授業、「演習」「基礎の演習」「発展の演習」は演習、「講習」は講習。
// それ以外（特別単価の名称など）は種類の名前のまま「その他」。料金は変えない（表示の名前だけ）

const PRACTICE = new Set(['演習', '基礎の演習', '発展の演習']);
const LESSON = new Set(['通常', '基礎の授業', '発展の授業']);
export const FORMS = ['授業', '演習', '講習', 'その他'];
// 形と、形のほかに出す種類の名前（「通常」「演習」のときは出さない）
export function formOf(kind) {
  const k = String(kind || '').trim() || '通常';
  if (LESSON.has(k)) return { form: '授業', detail: k === '通常' ? '' : k };
  if (PRACTICE.has(k)) return { form: '演習', detail: k === '演習' ? '' : k };
  if (k === '講習') return { form: '講習', detail: '' };
  return { form: 'その他', detail: k };
}
export const STATUS_LABEL = { draft: '下書き', proposed: '承認待ち', approved: '承認済み', declined: '見送り' };

// 行の内訳（目的・教材ごとの回数）。壊れた値・空は []
export function partsOf(line) {
  let v = line && line.parts;
  if (typeof v === 'string') { try { v = v ? JSON.parse(v) : []; } catch { v = []; } }
  if (!Array.isArray(v)) return [];
  return v.map(p => ({ label: String((p && p.label) || '').trim(), count: Number(p && p.count) }))
    .filter(p => p.label && Number.isInteger(p.count) && p.count > 0);
}
// 受講計画合意書の回数（承認済みは承認した回数、見送りは 0）と、お知らせした回数
export function plannedCount(l) {
  if (l.status === 'declined') return 0;
  if (l.status === 'approved' && l.approvedCount !== null && l.approvedCount !== undefined && l.approvedCount !== '') return Number(l.approvedCount);
  return Number(l.count);
}
const validFee = f => f !== null && f !== undefined && f !== '' && Number.isFinite(Number(f)) && Number(f) >= 0;
// 行の予定金額（円）。授業料が数でなければ null（0 円と見せない）
export function lineAmount(l) { return validFee(l.fee) ? plannedCount(l) * Math.round(Number(l.fee)) : null; }

// 科目ごとにまとめる。lines の並び（科目の最初に出た順）を保つ
// keyOf: まとめる鍵（既定は科目。保護者画面で兄弟がいるときは 生徒＋科目）
export function subjectGroups(lines, keyOf = l => String(l.subject || '')) {
  const map = new Map();
  for (const l of lines) {
    const key = keyOf(l);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  }
  return [...map.entries()].map(([key, ls]) => {
    const subject = String(ls[0].subject || '');
    const forms = {}, purposes = new Map(), unallocated = [], over = [];
    let amount = 0, unknown = 0;
    for (const l of ls) {
      const { form } = formOf(l.kind), n = plannedCount(l), a = lineAmount(l);
      forms[form] = (forms[form] || 0) + n;
      if (a === null) unknown++; else amount += a;
      // 内訳はお知らせした回数（count）に対して持つ。承認で回数が減ったときは、内訳と承認の回数が違うことを見せる
      const parts = partsOf(l), sum = parts.reduce((s, p) => s + p.count, 0), base = Number(l.count);
      for (const p of parts) {
        if (!purposes.has(p.label)) purposes.set(p.label, { label: p.label, forms: {}, lineIds: [] });
        const x = purposes.get(p.label); x.forms[form] = (x.forms[form] || 0) + p.count; if (!x.lineIds.includes(l.id)) x.lineIds.push(l.id);
      }
      if (parts.length && sum > base) over.push({ lineId: l.id, form, sum, count: base });
      else if (parts.length && sum < base) unallocated.push({ lineId: l.id, form, count: base - sum });
      else if (!parts.length && n > 0) unallocated.push({ lineId: l.id, form, count: n, none: true });
    }
    return { key, subject, lines: ls, forms, amount, unknown, purposes: [...purposes.values()], unallocated, over, reduced: ls.filter(l => l.status === 'approved' && plannedCount(l) !== Number(l.count) && partsOf(l).length) };
  });
}
// 全体（科目の小計を足すのではなく、元の行から直接足す。二重に数えない）
export function planTotals(lines) {
  const forms = {}; let amount = 0, unknown = 0;
  for (const l of lines) {
    const { form } = formOf(l.kind); forms[form] = (forms[form] || 0) + plannedCount(l);
    const a = lineAmount(l); if (a === null) unknown++; else amount += a;
  }
  return { forms, amount, unknown, lines: lines.length };
}
// まとまり: 生徒 × 期間 × 状態。並びは期間の早い順、同じ期間なら 下書き → 承認待ち → 承認済み → 見送り
const STATUS_ORDER = { draft: 0, proposed: 1, approved: 2, declined: 3 };
export const setKey = l => [l.studentId, l.startDate, l.endDate, l.status].join('|');
export function planSets(lines) {
  const map = new Map();
  for (const l of lines) { const k = setKey(l); if (!map.has(k)) map.set(k, []); map.get(k).push(l); }
  return [...map.entries()].map(([key, ls]) => ({ key, studentId: ls[0].studentId, startDate: ls[0].startDate, endDate: ls[0].endDate, status: ls[0].status, lines: ls }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
// 「授業 2回／演習 14回」
export function formsText(forms) {
  return FORMS.filter(f => forms[f]).map(f => `${f} ${forms[f]}回`).join('／') || '0回';
}
export const yenText = n => Number(n || 0).toLocaleString('ja-JP') + '円';
// 金額の表示。一部の行で算出できないときは「一部だけ」
export function amountText({ amount, unknown }) {
  return unknown ? (amount ? `${yenText(amount)}＋算出できない行 ${unknown}件` : '算出できません') : yenText(amount);
}
const mdText = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
export const periodText = (from, to) => `${mdText(from)}〜${mdText(to)}`;

// 科目のまとまりの中身（目的・教材ごとの回数、説明、行ごとの根拠）。管理画面のプレビューと保護者画面で同じものを出す
// esc は呼ぶ側の HTML エスケープ。opts.lineExtra(l) は行の末尾に足す HTML（保護者の回数の選択など）
export function subjectInfoHtml(g, esc) {
  let h = '';
  const notes = g.lines.filter(l => String(l.comment || '').trim());
  if (notes.length) h += `<div class="pv-notes">${notes.map(l => `<p class="pv-note"><span class="tag gray">${esc(formOf(l.kind).form)}</span> ${esc(l.comment)}</p>`).join('')}</div>`;
  if (g.purposes.length || g.over.length) {
    h += `<div class="pv-purposes" role="list" aria-label="目的・教材ごとの回数">${g.purposes.map(p => `<div class="pv-purpose" role="listitem"><span>${esc(p.label)}</span><b>${esc(formsText(p.forms))}</b></div>`).join('')}`;
    // 内訳の無い回数（内訳を持たない行・内訳が回数に足りない行）。形ごとに 1 行
    const rest = {}; for (const u of g.unallocated) rest[u.form] = (rest[u.form] || 0) + u.count;
    if (Object.keys(rest).length) h += `<div class="pv-purpose muted" role="listitem"><span>目的の内訳なし</span><b>${esc(formsText(rest))}</b></div>`;
    h += '</div>';
    if (g.over.length) h += `<p class="small pv-warn">目的ごとの回数の合計が、受講計画合意書の回数を超えています（${g.over.map(o => `${esc(o.form)} 内訳 ${o.sum}回／受講計画合意書 ${o.count}回`).join('・')}）。</p>`;
    if (g.reduced.length) h += `<p class="small muted">目的ごとの回数は、お知らせしたときの内訳です。</p>`;
  }
  return h;
}
export function subjectBodyHtml(g, esc, opts = {}) {
  let h = subjectInfoHtml(g, esc);
  h += `<div class="pv-lines">${g.lines.map(l => {
    const f = formOf(l.kind), n = plannedCount(l), a = lineAmount(l);
    const changed = l.status === 'approved' && n !== Number(l.count) ? `（お知らせ ${l.count}回）` : l.status === 'declined' ? '（見送り）' : '';
    return `<div class="pv-line"><span class="b"><span class="tag">${esc(f.form)}</span>${f.detail ? ` <span class="tag gray">${esc(f.detail)}</span>` : ''}${l.parentId ? ' <span class="tag">追加</span>' : ''} ${n}回${changed}<small class="muted">1回 ${esc(l.minutes)}分・${validFee(l.fee) ? yenText(l.fee) : '授業料が未設定'}${opts.period ? '・' + periodText(l.startDate, l.endDate) : ''}</small></span>${opts.lineExtra ? opts.lineExtra(l) : ''}<span class="amt">${a === null ? '算出できません' : yenText(a)}</span></div>`;
  }).join('')}</div>`;
  return h;
}
// 受講計画合意書全体のプレビュー（読むだけ。保存・送信・承認は起こさない）
// set: { startDate, endDate, status, lines }。opts.schedule: [{ lineId, assigned, tentative }]（日程の区画。管理画面だけ）
export function planPreviewHtml(set, esc, opts = {}) {
  const groups = subjectGroups(set.lines), t = planTotals(set.lines);
  let h = `<div class="pv"><p class="pv-head"><b>${esc(periodText(set.startDate, set.endDate))}</b> <span class="tag">${esc(STATUS_LABEL[set.status] || set.status)}</span>${opts.student ? ` ${esc(opts.student)}` : ''}</p>`;
  if (opts.others) h += `<p class="small muted" style="margin:2px 0 10px">同じ月のほかの受講計画合意書（${esc(opts.others)}）は含めていません。</p>`;
  for (const g of groups) {
    h += `<section class="pv-subject" aria-label="${esc(g.subject)}"><h3 class="pv-sub-head"><span>${esc(g.subject)}</span><small>${esc(formsText(g.forms))}</small><b>${esc(amountText(g))}</b></h3>${subjectBodyHtml(g, esc)}</section>`;
  }
  h += `<div class="pv-total"><span>期間全体（${esc(formsText(t.forms))}）</span><b>${esc(amountText(t))}</b></div>`;
  if (opts.schedule) {
    const rows = set.lines.map(l => { const s = opts.schedule.find(x => x.lineId === l.id) || {}; const n = plannedCount(l), placed = Number(s.assigned || 0) + Number(s.tentative || 0); return { l, s, rest: n - placed }; });
    h += `<section class="pv-schedule" aria-label="日程"><h3 class="pv-sub-head"><span>日程（受講計画合意書とは別）</span></h3><div class="pv-lines">${rows.map(({ l, s, rest }) => `<div class="pv-line"><span class="b">${esc(l.subject)} <span class="tag">${esc(formOf(l.kind).form)}</span><small class="muted">決定・実施 ${Number(s.assigned || 0)}回・調整中 ${Number(s.tentative || 0)}回${rest > 0 ? `・日時がまだの回数 ${rest}回` : rest < 0 ? `・受講計画合意書より ${-rest}回多い` : ''}</small></span></div>`).join('')}</div></section>`;
  }
  return h + '</div>';
}
