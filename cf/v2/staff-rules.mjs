// 講師マニュアル（雇用契約書 第9条7項）。2026-10-18 本人「運用の決まりは別で作ったほうがよいか」→ 契約には働く条件と重い約束だけ、
// 日々のやり方はここ。本人「その案で進めてください。その日の授業中に、その日のうち、LINE」（docs/STAFF_RULES_DRAFT.md）。
// - 中身はここに固定して持つ。変えるときは版（version）を上げる。講師は「読みました」を押し、その版の照合番号（hash）と一緒に auditLog に残す
// - 講師の画面と代表の画面（読んだ講師の一覧）は staff/rules.js。勤務開始までにすることに「講師マニュアル（本人の確認）」が入る（employment.mjs）
// - 入職の手続き中の講師も読めるように、経路は employment/ の下に置く
import { fail, audit, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { docPage, DOC_ISSUER } from './billing-doc.mjs';

export const STAFF_RULES = {
  version: '2026-11',
  title: '講師マニュアル（2026年11月版）',
  intro: 'ステップワイズ個別指導で働くときの、日々の仕事のやり方です。雇用契約書の第9条7項にもとづきます。変えるときは、前もって講師の画面でお知らせします。',
  sections: [
    ['授業', [
      '教室での授業は、当面、代表が同じ場にいるときに限って行います。',
      'オンラインの授業は、当面行いません。始めるときは、場所と進め方を前もってお知らせします。',
      '授業の前に、授業記録の「前回のこと・引き継ぎメモ・宿題」に目を通します。',
      '授業記録は、その日の授業中に塾のシステムに入れます。',
    ]],
    ['勤務の予定と実績', [
      '翌月のシフトは、前の月の下旬までに代表と話し合って決めます。決まったシフトは講師の画面に出るので、内容を確かめて「確認」を押してください。',
      '勤務した日は、その日のうちに、実績（授業・準備と記録・その他の仕事の時間）を講師の画面で出します。',
      '予定と違う時間に働いたときは、実績の「補足」にわけを書きます。',
    ]],
    ['遅刻・欠勤', [
      '遅れる、または休むと分かったら、その時点ですぐ LINE で代表に連絡します。',
      '授業の振替や保護者への連絡は、代表が行います。講師から保護者に直接連絡しないでください。',
    ]],
    ['生徒・保護者との連絡', [
      '生徒・保護者との連絡は、塾を通して行います（保護者ページ、塾の LINE など）。',
      '自分の電話番号・メールアドレス・SNS のアカウントを、生徒・保護者に教えないでください。聞かれたときは「塾を通してください」と伝えます。',
      '保護者から授業や料金のことを直接聞かれたときは、その場で約束せず、代表に伝えます。',
    ]],
    ['生徒の安全', [
      '生徒と二人きりで、外から見えない場所にいないようにします。',
      '生徒がけがをした、体調が悪い、ようすがいつもと違うときは、すぐ代表に知らせます。保護者への連絡は代表が行います。',
      '地震・火事などのときは、生徒を先に避難させ、代表の指示に従います。',
      '生徒から、いじめ・家庭のこと・からだのことなど、安全にかかわる相談を受けたときは、一人で抱えず代表に知らせます。',
    ]],
    ['個人情報', [
      '生徒の答案・ノート・成績を、自分のスマートフォンなどで撮影したり、保存したりしないでください。',
      '塾のシステムに入る機器には、画面のロックをかけます。人と共用の機器では、ログインしたままにしません。',
      '教室の外で、生徒や保護者のことを話題にしません。',
    ]],
    ['困ったとき', [
      'わからないこと、困ったことは、いつでも代表に相談してください（雇用契約書 第11条2項の相談の窓口）。',
    ]],
  ],
};
export const STAFF_RULES_HASH = sha256Hex(JSON.stringify(STAFF_RULES));

// 書面（請求書・契約書と同じ A4）。2026-10-18 本人「書類みたいに表示できるスタイルが良い。印刷して渡す可能性もある」。
// 紙で渡すときのために、末尾に受け取りの欄（日付・講師の署名）を付ける
const escH = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export function rulesDocHtml() {
  const r = STAFF_RULES;
  const body = `
  <div class="head"><h1>講師マニュアル</h1><div class="meta">${escH(r.title.replace('講師マニュアル', '').replace(/[（）]/g, ''))}<br>照合番号 ${escH(STAFF_RULES_HASH.slice(0, 12))}</div></div>
  <p style="margin:6mm 0 0;line-height:1.9">${escH(r.intro)}</p>
  <style>.rsec{break-inside:avoid;page-break-inside:avoid}@media screen and (max-width:820px){.sheet{width:auto;min-height:0;margin:0;padding:6mm 5mm;box-shadow:none}.head{flex-direction:column;gap:2mm}.meta{text-align:left}h1{font-size:22px;letter-spacing:.2em}}</style>
  ${r.sections.map(([title, items], i) => `<div class="rsec"><h2 style="margin:6mm 0 1mm;font-size:14px;border-bottom:1px solid #b9c0c8;padding-bottom:1mm">${i + 1}. ${escH(title)}</h2><ol style="margin:0;padding-left:1.6em;line-height:1.9">${items.map(x => `<li>${escH(x)}</li>`).join('')}</ol></div>`).join('')}
  <div style="margin-top:9mm;border:1px solid #b9c0c8;padding:4mm 5mm;line-height:2.2;break-inside:avoid"><div style="font-weight:bold">受け取りの記録</div>この「講師マニュアル」を受け取り、内容を確かめました。<br>日付：　　　　年　　月　　日<br>講師の氏名（署名）：</div>
  <div style="margin-top:8mm;display:flex;justify-content:flex-end">${DOC_ISSUER()}</div>`;
  return docPage(r.title, `${r.title}。印刷（Ctrl+P）で PDF に保存できます。`, body);
}

// 今の版を読んだ日時（読んでいなければ ''）
export async function rulesReadAt(c, staffId) {
  const r = await c.db.prepare("select at from auditLog where action = 'staffRulesRead' and target = ? and json_extract(detail, '$.hash') = ? order by id desc limit 1").bind(String(staffId), STAFF_RULES_HASH).first();
  return r ? r.at : '';
}

export const staffRulesRoutes = {
  'employment/rules/get': async (c, b) => {
    const me = await requireStaff(c, b);
    const out = { rules: STAFF_RULES, hash: STAFF_RULES_HASH, readAt: me.contractType === 'employee' ? await rulesReadAt(c, me.id) : '' };
    if (me.contractType === 'owner') {
      const rows = (await c.db.prepare("select id, name, status from staff where contractType = 'employee' and status <> 'stopped' order by createdAt").all()).results;
      out.readers = [];
      for (const s of rows) out.readers.push({ id: s.id, name: s.name, readAt: await rulesReadAt(c, s.id) });
    }
    return out;
  },
  'employment/rules/document': async (c, b) => { await requireStaff(c, b); return { html: rulesDocHtml() }; },
  'employment/rules/read': async (c, b) => {
    const me = await requireStaff(c, b);
    if (me.contractType !== 'employee') fail('forbidden', '講師が読んだことを残す操作です', 403);
    if (b.hash !== STAFF_RULES_HASH) fail('staleRules', '講師マニュアルが新しくなっています。画面を読み直してください', 409);
    if (b.confirm !== true) fail('needConfirm', '読んだことを確かめる印を付けてください');
    if (!(await rulesReadAt(c, me.id))) await audit(c, 'staffRulesRead', me.id, { version: STAFF_RULES.version, hash: STAFF_RULES_HASH });
    return { readAt: await rulesReadAt(c, me.id) };
  },
};
