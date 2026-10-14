// 書類のひな形（設定 → 書類のひな形）。2026-10-12 本人「書類に関するひな形みたいなのをパッと確認できる場所が欲しい」。
// 台帳に残す書面（受講条件書（通常指導）・受講条件書（特殊指導）・請求書・領収書）を、架空の家族（見本家）で描いて返す。読むだけ。
// 請求書の振込先・備考だけは本番の設定を使う（今どう載るかを確かめるため）。
import { fail, iso } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { currentTerms } from './terms.mjs';
import { conditionDocHtml } from './condition-doc.mjs';
import { specialDocHtml } from './special-doc.mjs';
import { invoiceDocHtml, receiptDocHtml, billingSettings } from './billing-doc.mjs';

const family = { id: 'fam_sample', name: '見本家', guardianName: '見本 花子' };
const student = { id: 'stu_sample', familyName: '見本', givenName: '太郎', grade: '中3' };

export const DOC_TYPES = {
  condition: { title: '受講条件書（通常指導）', when: '生徒ごとに「条件を決めてお知らせ」したとき（案）と、保護者が同意したとき（確定）', who: '保護者はお支払いから。塾は生徒の画面から', where: '家族の画面 → 生徒 → 受講条件書（通常指導）' },
  special: { title: '受講条件書（特殊指導）', when: '特殊指導を提案したとき（案）と、保護者が承認したとき（確定）', who: '保護者はお支払いから。塾は生徒の画面から', where: '家族の画面 → 生徒 → 特殊指導' },
  invoice: { title: '請求書', when: '月の請求を確定したとき', who: '保護者はお支払いの請求から。塾は請求の画面から', where: '請求 → 家族の月。振込先と備考は 設定 → 請求の下の「請求書の設定」' },
  receipt: { title: '領収書', when: '入金を記録したとき', who: '保護者はお支払いの請求から。塾は請求の画面から', where: '請求 → 家族の月 → 入金を記録' },
};

export async function sampleDocHtml(db, type, now) {
  const terms = await currentTerms(db);
  const at = iso(now);
  if (type === 'condition') {
    const cond = { id: 'cond_sample', templateVersion: '20261014-r5', consenterName: '見本 花子', recordedAt: at, recordedByName: '見本 花子', no: 1, minutes: 90, fee: 4500, deliveryMode: 'in_person', groupSize: '講師1名につき生徒最大2名', studentContact: 1, subjects: '英語・数学', note: '', fromMonth: '2026-11', termsVersion: terms.version, status: 'agreed', proposedAt: at, agreedAt: at, agreedVia: '保護者ページ', agreedBy: 'family:fam_sample', agreedNote: '' };
    return conditionDocHtml({ cond, student, family, terms, proposer: '麦倉 優輔', now: at });
  }
  if (type === 'special') {
    const sp = { id: 'sp_sample', templateVersion: '20261014-r5', purpose: '英検準1級の合格に必要な技能を身につける', consenterName: '見本 花子', recordedAt: at, recordedByName: '見本 花子', no: 1, title: '英検準1級対策', content: '過去問の長文読解とライティングの添削。毎回、前回の答案を講師が採点して返し、次回の課題を決める。', reason: '毎回の答案の添削と、準1級の語彙・長文の準備に1回あたり2時間かかる。この準備はほかの生徒の指導には使えない。', prep: '過去問の解答作成、答案の添削', minutes: 90, fee: 7000, fromDate: '2026-11-01', toDate: '2027-01-31', note: '', termsVersion: terms.version, status: 'agreed', proposedAt: at, agreedAt: at, agreedVia: '保護者ページ', agreedBy: 'family:fam_sample', agreedNote: '' };
    return specialDocHtml({ sp, student, family, terms, proposer: '麦倉 優輔', now: at });
  }
  const inv = { id: 'inv_sample01', month: '2026-11', total: 19000, confirmedAt: '2026-12-03T00:10:00.000Z', paidOn: '2026-12-10', paidMethod: '振込' };
  if (type === 'invoice') {
    const items = [
      { date: '2026-11-04', studentName: '見本 太郎', kind: 'lesson', subject: '英語', lessonKind: '通常', minutes: 90, amount: 4500 },
      { date: '2026-11-11', studentName: '見本 太郎', kind: 'lesson', subject: '英語', lessonKind: '通常', minutes: 90, amount: 4500 },
      { date: '2026-11-18', studentName: '見本 太郎', kind: 'lesson', subject: '英語', lessonKind: '英検準1級対策', minutes: 90, amount: 7000 },
      { date: '2026-11-25', studentName: '見本 太郎', kind: 'cancelFee', subject: '', label: '当日のご連絡', minutes: 0, amount: 1000 },
      { date: '2026-11-27', studentName: '見本 太郎', kind: 'lesson', subject: '数学', lessonKind: '通常', minutes: 60, amount: 2000 },
    ];
    return invoiceDocHtml({ inv, items, family, settings: await billingSettings(db) });
  }
  if (type === 'receipt') return receiptDocHtml({ inv, family });
  fail('badType', 'その書類はありません');
}

export const docsSampleRoutes = {
  'admin/docs/sample': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const type = String(b.type || '');
    if (!DOC_TYPES[type]) fail('badType', 'その書類はありません');
    return { type, title: DOC_TYPES[type].title, html: await sampleDocHtml(c.db, type, c.now) };
  },
};
