// 入塾の案内と申込み（2026-10-18 本人決定。migrations-v2/0032_family_enrollment.sql）。
// 体験 → ① 代表が「入塾の案内を送る」（保護者のメールと受講条件。個別受講条件書の案ができ、招待のメールが届く）
//      → ② 保護者がパスワードを決める → ③ 保護者が 1 つの画面で申込み（保護者の情報・生徒の情報の確認・共通規約と個別受講条件書への同意）
//      → ④ そのまま入塾（体験の印を外し、代表にメール）。そのあとは授業ごとの合意（まとまった回数なら受講計画書）。
// - 申込みのあと代表の確認は挟まない（本人「そのまま入塾」）。受講条件は案内のときに代表が決める。
// - 申込みの内容（受講申込書の控え）は enrollmentOffers.application に残し、変えない（トリガー）。
// - 規約の同意・個別受講条件書の同意・申込み・入塾は 1 回の書き込み（batch）で行う。同意者名は保護者が入れた氏名。
// 契約の更新（kind = renewal。2026-10-29 本人「新しい規約と契約書類に以前から利用している顧客に承認してもらう…入塾手続きを転用」。0036_offer_kind.sql）:
//   在籍している生徒の家族に、生徒ごとの個別受講条件書の案と今の共通規約を 1 通で案内し、保護者は同じ申込みの画面で情報を確かめて同意する。
//   入塾の印（体験・入塾日・専用リンク・家族の表示名）は変えない。同意するまでは今の決まりのまま（システムは切り替えない）
import { fail, newId, iso, audit, normEmail, validEmail, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { issueChallenge } from './accounts.mjs';
import { familyNotice, staffNotice, todayJst } from './schedule.mjs';
import { currentTerms, termsConsentStatements, termsForVersion } from './terms.mjs';
import { conditionDocHtml } from './condition-doc.mjs';
import { conditionFields, proposeCondition, studentConditions, storeDoc, MODE_LABEL } from './conditions.mjs';
import { consentEvidence } from './consent-evidence.mjs';
import { GRADES, normGrade } from '../../assets/v2/grade-options.js';

const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');
const monthText = m => m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const KANA = /^[ぁ-ゖァ-ヺー・\s　]+$/;
// 生徒の専用リンクの鍵（people.mjs と同じ作り）。MCP で登録した体験生の使えない鍵（off.）は、入塾のときに作り直す
const newLinkCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const offerView = r => r ? ({ id: r.id, kind: r.kind || 'enroll', familyId: r.familyId, studentId: r.studentId, conditionId: r.conditionId, fromMonth: r.fromMonth, status: r.status,
  offeredAt: r.offeredAt, offeredByName: r.offeredByName, appliedAt: r.appliedAt, consenterName: r.consenterName, termsVersion: r.termsVersion, withdrawnAt: r.withdrawnAt, version: r.version }) : null;

// 生徒の入塾の手続き（スタッフの生徒の画面・一覧で使う）。latest は最後の案内（取り消したものは除く）
export async function studentEnrollment(db, studentId, kind = 'enroll') {
  const r = await db.prepare("select * from enrollmentOffers where studentId = ? and status <> 'withdrawn' and kind = ? order by offeredAt desc limit 1").bind(studentId, kind).first();
  if (!r) return null;
  const v = offerView(r);
  if (r.status === 'applied') { try { v.application = JSON.parse(r.application); } catch {} }
  return v;
}
export async function enrollmentStates(db) {
  const rows = (await db.prepare("select studentId, status from enrollmentOffers where status = 'offered' and kind = 'enroll'").all()).results;
  return Object.fromEntries(rows.map(r => [r.studentId, r.status]));
}

async function getStudent(c, id) { const s = await c.db.prepare('select * from students where id = ?').bind(String(id || '')).first(); if (!s) fail('notFound', '生徒が見つかりません', 404); return s; }
async function getFamily(c, id) { const f = await c.db.prepare('select * from families where id = ?').bind(String(id || '')).first(); if (!f) fail('notFound', '家族が見つかりません', 404); return f; }
async function getOffer(c, id) { const r = await c.db.prepare('select * from enrollmentOffers where id = ?').bind(String(id || '')).first(); if (!r) fail('notFound', '入塾の案内が見つかりません', 404); return r; }

const inviteMail = (s, cond) => ({ subject: '【ステップワイズ】入塾のお手続きのご案内', body: url => `${fullName(s)}さんの保護者さま\n\nステップワイズ個別指導です。入塾のお手続きをご案内します。\n7日以内に次のリンクを開き、保護者ページのパスワードを決めてください。続けて、保護者さまの情報のご登録と、共通規約・個別受講条件書のご確認をお願いします。\n\n${url}\n\n保護者ページで「同意して入塾を申し込む」を押すと、お申込みが完了します。\nリンクの期限が切れた場合は、いつものLINEまたは mugilives@gmail.com へご連絡ください。\n心当たりがない場合は、このメールを破棄してください。` });
const activeText = (s, cond) => `${fullName(s)}さんの入塾のお手続きをご案内します。保護者ページの「入塾のお申込み」で、保護者さまの情報と共通規約・個別受講条件書をご確認のうえ、お申し込みください。`; // 料金などは申込みの画面で（2026-10-26 本人「料金とかはこの段階では見せなくていい」）

// 契約更新の手続きの案内（家族に 1 通。生徒が何人でも）
// 初めて書面を交わす家族にも合う文（2026-10-30 本人「山本さんは…今まで契約書とかは一回も書いたことがない」）
const renewalText = (names, fromMonth) => `${names}の共通規約と個別受講条件書をご用意しました。保護者ページの「契約更新の手続き」で、保護者さまの情報と内容をご確認のうえ、同意をお願いします。\n${monthText(fromMonth)}からの授業に適用します。ご同意いただくまでは、今までどおり授業を続けます。`;
const renewalMail = (names, fromMonth) => ({ subject: '【ステップワイズ】共通規約と個別受講条件書のご確認のお願い', body: url => `${names}の保護者さま\n\nステップワイズ個別指導です。${renewalText(names, fromMonth)}\n\n下のリンクから保護者ページを開いてください（7日間有効・1回だけ）。\n${url}` });
async function sendRenewal(c, f, students, fromMonth) {
  const names = students.map(s => fullName(s) + 'さん').join('・');
  if (f.passHash && f.status === 'active') { const sent = await familyNotice(c, students[0].id, '共通規約と個別受講条件書のご確認のお願い', renewalText(names, fromMonth), 'enroll'); return { inviteUrl: '', mailed: sent }; }
  const inviteUrl = await issueChallenge(c, 'family', 'familyInvite', f, renewalMail(names, fromMonth), 'enroll');
  return { inviteUrl, mailed: !c.effects.some(e => e.audience === 'family' && e.held) };
}
// 家族の画面に出す、生徒ごとの契約の更新（最後の案内。取り消したものは除く）
export async function familyRenewals(db, familyId) {
  const rows = (await db.prepare("select * from enrollmentOffers where familyId = ? and kind = 'renewal' and status <> 'withdrawn' order by offeredAt").bind(familyId).all()).results;
  const out = {}; for (const r of rows) out[r.studentId] = offerView(r);
  return out;
}

// 案内のメール（パスワードがまだなら招待のリンク、登録済みなら保護者ページのお知らせ）
async function sendOffer(c, f, s, cond) {
  if (f.passHash && f.status === 'active') { const sent = await familyNotice(c, s.id, '入塾のお手続きのお願い', activeText(s, cond), 'enroll'); return { inviteUrl: '', mailed: sent }; }
  const inviteUrl = await issueChallenge(c, 'family', 'familyInvite', f, inviteMail(s, cond), 'enroll');
  return { inviteUrl, mailed: !c.effects.some(e => e.audience === 'family' && e.held) };
}

function text(v, max, label, required = false) {
  const s = String(v ?? '').trim();
  if (required && !s) fail('needField', label + 'を入れてください');
  if (s.length > max) fail('tooLong', `${label}は${max}文字以内で入れてください`);
  return s;
}
// 保護者の申込みの中身（受講申込書）。住所は郵便番号と合わせて「〒…」の 1 つの文で残す
function applicationFields(b) {
  // 保護者の氏名は姓・名に分けて受け取る（2026-10-19 本人）。書面・同意の氏名は「姓 名」
  const gFamily = text(b.guardianFamilyName, 30, '保護者の姓', true), gGiven = text(b.guardianGivenName, 30, '保護者の名', true);
  const gFamilyKana = text(b.guardianFamilyKana, 30, '保護者の姓のふりがな', true), gGivenKana = text(b.guardianGivenKana, 30, '保護者の名のふりがな', true);
  if (!KANA.test(gFamilyKana + gGivenKana)) fail('badKana', 'ふりがなは、ひらがなかカタカナで入れてください');
  const guardianName = gFamily + ' ' + gGiven, guardianKana = gFamilyKana + ' ' + gGivenKana;
  const phone = text(b.phone, 20, '電話番号', true), digits = phone.replace(/\D/g, '');
  if (!/^[0-9+\-() ]+$/.test(phone) || digits.length < 10 || digits.length > 11) fail('badPhone', '電話番号を確かめてください（例：090-1234-5678）');
  const zip = text(b.zip, 8, '郵便番号', true).replace(/^(\d{3})(\d{4})$/, '$1-$2');
  if (!/^\d{3}-\d{4}$/.test(zip)) fail('badZip', '郵便番号は7桁で入れてください（例：343-0002）');
  const addr = text(b.address, 200, '住所', true);
  const st = b.student || {};
  const student = { familyName: text(st.familyName, 40, '生徒の名字', true), givenName: text(st.givenName, 40, '生徒の名前', true),
    familyKana: text(st.familyKana, 40, '生徒の名字のふりがな', true), givenKana: text(st.givenKana, 40, '生徒の名前のふりがな', true),
    grade: normGrade(text(st.grade, 20, '学年', true)), school: text(st.school, 60, '学校', true) };
  if (!GRADES.includes(student.grade)) fail('badGrade', '学年を選んでください');
  if (!KANA.test(student.familyKana + student.givenKana)) fail('badKana', 'ふりがなは、ひらがなかカタカナで入れてください');
  return { guardian: { familyName: gFamily, givenName: gGiven, familyKana: gFamilyKana, givenKana: gGivenKana, name: guardianName, kana: guardianKana, phone, address: '〒' + zip + ' ' + addr }, student };
}

// ---- 申込み・同意の書き込み（入塾は 1 人ずつ、契約の更新は兄弟をまとめて） ----
async function applyTerms(c, b) {
  const terms = await currentTerms(c.db);
  if (!terms.version) fail('noTerms', '共通規約の準備ができていません。教室にお問い合わせください', 409);
  if (String(b.termsVersion || '') !== terms.version) fail('staleVersion', '共通規約が新しくなっています。画面を更新して、もう一度確かめてください', 409);
  return terms;
}
async function applyTarget(c, me, offerId, conditionId) {
  const r = await getOffer(c, offerId);
  if (r.familyId !== me.id) fail('notFound', '入塾の案内が見つかりません', 404);
  if (r.status !== 'offered') fail('closed', r.status === 'applied' ? 'お申込みはもう完了しています' : 'この案内は取り消されました。教室にお問い合わせください', 409);
  const cond = await c.db.prepare('select * from conditions where id = ?').bind(r.conditionId).first();
  if (String(conditionId || '') !== r.conditionId || !cond || cond.status !== 'proposed') fail('staleCondition', '個別受講条件書が変わりました。画面を更新して、もう一度確かめてください', 409);
  return { r, cond, s: await getStudent(c, r.studentId) };
}
// 案内・生徒・個別受講条件書の書き込み（家族と共通規約は呼ぶ側で 1 回）
function applyStatements(c, me, { r, cond, s }, app, terms, evidence) {
  const renewal = r.kind === 'renewal', now = iso(c.now), at = evidence.consentedAt, today = todayJst(c.now);
  const enrolledOn = renewal ? s.enrolledOn || '' : r.fromMonth + '-01' > today ? r.fromMonth + '-01' : today;
  const via = renewal ? '保護者ページ（契約更新の手続き）' : '保護者ページ（入塾の申込み）';
  const snapshot = { appliedAt: now, guardian: { ...app.guardian, email: me.email }, student: app.student,
    condition: { id: cond.id, no: cond.no, minutes: cond.minutes, fee: cond.fee, deliveryMode: cond.deliveryMode, subjects: cond.subjects, note: cond.note, fromMonth: cond.fromMonth },
    terms: { version: terms.version, title: terms.title, url: terms.url }, enrolledOn };
  const json = JSON.stringify(snapshot);
  return { via, enrolledOn, stmts: [
    c.db.prepare("update enrollmentOffers set status = 'applied', appliedAt = ?, application = ?, contentHash = ?, termsVersion = ?, consenterName = ?, version = version + 1 where id = ? and status = 'offered'")
      .bind(now, json, sha256Hex(json), terms.version, evidence.consenterName, r.id),
    renewal ? c.db.prepare('update students set familyName = ?, givenName = ?, familyKana = ?, givenKana = ?, grade = ?, school = ?, updatedAt = ?, version = version + 1 where id = ?')
      .bind(app.student.familyName, app.student.givenName, app.student.familyKana, app.student.givenKana, app.student.grade, app.student.school, now, s.id)
    : c.db.prepare("update students set familyName = ?, givenName = ?, familyKana = ?, givenKana = ?, grade = ?, school = ?, trial = 0, enrolledOn = ?, linkCode = case when linkCode like 'off.%' then ? else linkCode end, updatedAt = ?, version = version + 1 where id = ?")
      .bind(app.student.familyName, app.student.givenName, app.student.familyKana, app.student.givenKana, app.student.grade, app.student.school, enrolledOn, newLinkCode(), now, s.id),
    c.db.prepare("update conditions set status = 'agreed', agreedAt = ?, agreedVia = ?, agreedBy = ?, agreedNote = ?, consenterName = ?, recordedAt = ?, recordedByName = ?, updatedAt = ? where id = ? and status = 'proposed'")
      .bind(at, via, 'family:' + me.id, '', evidence.consenterName, evidence.recordedAt, evidence.recordedByName, now, cond.id),
  ] };
}
const familyUpdate = (c, me, app, label, now) => c.db.prepare('update families set name = ?, guardianName = ?, guardianKana = ?, guardianFamilyName = ?, guardianGivenName = ?, guardianFamilyKana = ?, guardianGivenKana = ?, phone = ?, address = ?, updatedAt = ?, version = version + 1 where id = ?')
  .bind(label, app.guardian.name, app.guardian.kana, app.guardian.familyName, app.guardian.givenName, app.guardian.familyKana, app.guardian.givenKana, app.guardian.phone, app.guardian.address, now, me.id);
// 契約更新の受付: 保護者に 1 通、代表に 1 通（兄弟をまとめて）
async function renewalMails(c, guardianName, list) {
  const nm = ({ app }) => app.student.familyName + ' ' + app.student.givenName + 'さん';
  const names = list.map(nm).join('・'), month = monthText(list[0].x.r.fromMonth);
  const docs = list.map(o => `${nm(o)}：個別受講条件書（第${o.x.cond.no}版）`).join('\n');
  await familyNotice(c, list[0].x.s.id, '契約更新の手続きを受け付けました', `${names}の契約更新の手続き（共通規約と個別受講条件書への同意）を受け付けました。
${docs}
${month}からの授業は、新しい個別受講条件書の内容で行います。
同意した書面の控えは、保護者ページの「契約」でいつでも確かめられます。`, 'contracts');
  await staffNotice(c, `【契約更新】${names}`, `${names}の保護者（${guardianName}）が、共通規約と個別受講条件書に同意しました（${month}から）。\n${docs}`);
}

export const enrollmentRoutes = {
  // ① 入塾の案内を送る（体験生）。保護者のメールと受講条件を入れる
  'admin/enrollment/offer': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const s = await getStudent(c, b.studentId);
    if (!s.trial) fail('notTrial', 'この生徒はもう入塾しています');
    if (s.status === 'left') fail('left', '退会した生徒には案内できません');
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('needTerms', '先に「設定 → 共通規約」で、共通規約を使い始めてください。保護者は申込みのときに規約に同意します', 409);
    let f = await getFamily(c, s.familyId);
    if (f.status === 'stopped') fail('stopped', '停止中の家族には案内できません');
    const email = normEmail(b.email || f.email);
    if (!validEmail(email)) fail('badEmail', '保護者のメールアドレスを確かめてください');
    if (email !== f.email) {
      if (f.passHash) fail('emailFixed', 'この家族は保護者ページに登録済みです。メールアドレスは家族の画面で変えてください', 409);
      if (await c.db.prepare('select 1 from families where email = ? and id <> ?').bind(email, f.id).first()) fail('duplicate', 'このメールアドレスはほかの家族で使われています', 409);
    }
    const cond = conditionFields(b), now = iso(c.now), id = newId('eo');
    await c.db.batch([
      c.db.prepare("update enrollmentOffers set status = 'withdrawn', withdrawnAt = ?, version = version + 1 where studentId = ? and status = 'offered'").bind(now, s.id),
      c.db.prepare('update families set email = ?, updatedAt = ?, version = version + 1 where id = ?').bind(email, now, f.id),
    ]);
    const { id: conditionId } = await proposeCondition(c, me, s, cond);
    await c.db.prepare('insert into enrollmentOffers (id, familyId, studentId, conditionId, fromMonth, status, offeredAt, offeredBy, offeredByName) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, f.id, s.id, conditionId, cond.fromMonth, 'offered', now, 'staff:' + me.id, String(me.name || '')).run();
    f = await getFamily(c, f.id);
    const sent = await sendOffer(c, f, s, cond);
    await audit(c, 'enrollmentOffer', id, { studentId: s.id, conditionId, fromMonth: cond.fromMonth });
    return { enrollment: await studentEnrollment(c.db, s.id), ...sent };
  },
  // 契約の更新を送る（在籍している生徒の家族）。生徒ごとに個別受講条件書の案を作り、家族に 1 通。同じ生徒の前の案内は取り下げる
  'admin/renewal/offer': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('needTerms', '先に「設定 → 共通規約」で、共通規約を使い始めてください', 409);
    const f = await getFamily(c, b.familyId);
    if (f.status === 'stopped') fail('stopped', '保護者ページとメールを止めている家族には案内できません');
    if (!validEmail(f.email)) fail('badEmail', '先に保護者のメールアドレスを入れてください');
    const list = Array.isArray(b.students) ? b.students : [];
    if (!list.length || list.length > 10) fail('needStudents', '案内する生徒を選んでください');
    const picked = [];
    for (const x of list) {
      const s = await getStudent(c, x.studentId);
      if (s.familyId !== f.id) fail('notFound', '生徒が見つかりません', 404);
      if (s.trial) fail('trial', `${fullName(s)}さんは体験生です。生徒の画面の「入塾の手続き」から案内してください`);
      if (s.status === 'left') fail('left', `${fullName(s)}さんは退会しています`);
      picked.push({ s, cond: conditionFields({ ...x, fromMonth: b.fromMonth, studentContact: x.studentContact !== false }) });
    }
    const now = iso(c.now), ids = [];
    for (const { s, cond } of picked) {
      await c.db.prepare("update enrollmentOffers set status = 'withdrawn', withdrawnAt = ?, version = version + 1 where studentId = ? and status = 'offered'").bind(now, s.id).run();
      const { id: conditionId } = await proposeCondition(c, me, s, cond), id = newId('eo');
      await c.db.prepare("insert into enrollmentOffers (id, familyId, studentId, conditionId, fromMonth, status, offeredAt, offeredBy, offeredByName, kind) values (?, ?, ?, ?, ?, 'offered', ?, ?, ?, 'renewal')")
        .bind(id, f.id, s.id, conditionId, cond.fromMonth, now, 'staff:' + me.id, String(me.name || '')).run();
      ids.push(id);
    }
    const sent = await sendRenewal(c, await getFamily(c, f.id), picked.map(x => x.s), picked[0].cond.fromMonth);
    await audit(c, 'renewalOffer', f.id, { offers: ids, fromMonth: picked[0].cond.fromMonth });
    return { renewals: await familyRenewals(c.db, f.id), ...sent };
  },
  // 案内をもう一度送る（リンクの期限切れ・メールが届かない）
  'admin/enrollment/resend': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const r = await getOffer(c, b.offerId);
    if (r.status !== 'offered') fail('closed', 'この案内はもう申し込まれたか、取り消されています', 409);
    const s = await getStudent(c, r.studentId), f = await getFamily(c, r.familyId);
    const cond = await c.db.prepare('select * from conditions where id = ?').bind(r.conditionId).first();
    let sent;
    if (r.kind === 'renewal') { // 契約の更新は、まだの生徒をまとめて 1 通
      const open = (await c.db.prepare("select studentId from enrollmentOffers where familyId = ? and kind = 'renewal' and status = 'offered' order by offeredAt").bind(f.id).all()).results;
      const students = []; for (const o of open) students.push(await getStudent(c, o.studentId));
      sent = await sendRenewal(c, f, students, r.fromMonth);
    } else sent = await sendOffer(c, f, s, cond);
    await audit(c, 'enrollmentResend', r.id);
    return { enrollment: await studentEnrollment(c.db, s.id), ...sent };
  },
  // 案内を取り消す（条件を変えるときは、取り消さずにもう一度「入塾の案内を送る」）
  'admin/enrollment/withdraw': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const r = await getOffer(c, b.offerId);
    if (r.status !== 'offered') fail('closed', 'この案内はもう申し込まれたか、取り消されています', 409);
    const now = iso(c.now);
    await c.db.batch([
      c.db.prepare("update enrollmentOffers set status = 'withdrawn', withdrawnAt = ?, version = version + 1 where id = ? and status = 'offered'").bind(now, r.id),
      c.db.prepare("update conditions set status = 'replaced', updatedAt = ? where id = ? and status = 'proposed'").bind(now, r.conditionId),
    ]);
    await audit(c, 'enrollmentWithdraw', r.id);
    return { enrollment: await studentEnrollment(c.db, r.studentId) };
  },

  // ---- 保護者 ----
  // 申込みの画面に出すもの: 案内（生徒・個別受講条件書）、今の共通規約、保護者の今の情報
  'family/enrollment': async (c, b) => {
    const me = await requireFamily(c, b);
    const rows = (await c.db.prepare("select * from enrollmentOffers where familyId = ? and status in ('offered', 'applied') order by offeredAt").bind(me.id).all()).results;
    const offers = [];
    for (const r of rows) {
      if (r.status === 'applied' && r.appliedAt < iso(c.now - 14 * 86400e3)) continue; // 申し込んだものは 2 週間だけ「済み」として見せる
      const s = await getStudent(c, r.studentId), conds = await studentConditions(c.db, s.id);
      const cond = (conds.history || []).find(x => x.id === r.conditionId) || null;
      offers.push({ ...offerView(r), student: { id: s.id, familyName: s.familyName, givenName: s.givenName, familyKana: s.familyKana, givenKana: s.givenKana, grade: normGrade(s.grade), school: s.school, name: fullName(s) }, condition: cond });
    }
    const zip = /^〒(\d{3}-\d{4}) ?(.*)$/.exec(me.address || '');
    // 姓・名を分けて持つ前の家族は、「姓 名」の空白で分けて最初の値にする
    // 空白がなければ、生徒の名字で始まるところで分ける（例: 「山本あさこ」→ 山本・あさこ。2026-10-30 山本さんの契約更新の手続きの前に）
    const surnames = offers.map(o => o.student.familyName).filter(Boolean);
    const split = v => { const t = String(v || '').trim(), m = /^(\S+)[\s　]+(.+)$/.exec(t); if (m) return [m[1], m[2]]; const sn = surnames.find(x => t.startsWith(x) && t.length > x.length); return sn ? [sn, t.slice(sn.length)] : [t, '']; };
    const [nf, ng] = me.guardianFamilyName || me.guardianGivenName ? [me.guardianFamilyName, me.guardianGivenName] : split(me.guardianName);
    const [kf, kg] = me.guardianFamilyKana || me.guardianGivenKana ? [me.guardianFamilyKana, me.guardianGivenKana] : split(me.guardianKana);
    return { offers, terms: await currentTerms(c.db),
      guardian: { familyName: nf || '', givenName: ng || '', familyKana: kf || '', givenKana: kg || '', phone: me.phone || '', zip: zip ? zip[1] : '', address: zip ? zip[2] : (me.address || ''), email: me.email } };
  },
  // 申込みの画面で開く個別受講条件書の全文。宛名・生徒は画面に入れた内容で作る（保存はしない。2026-10-26 本人「契約者は保護者…氏名もわかっているし、それをそのまま表示するべき」）
  'family/enrollment/document': async (c, b) => {
    const me = await requireFamily(c, b);
    const r = await getOffer(c, b.offerId);
    if (r.familyId !== me.id || r.status !== 'offered') fail('notFound', '入塾の案内が見つかりません', 404);
    const cond = await c.db.prepare('select * from conditions where id = ?').bind(r.conditionId).first();
    if (!cond) fail('notFound', '個別受講条件書が見つかりません', 404);
    const s = await getStudent(c, r.studentId);
    const v = k => typeof b[k] === 'string' ? b[k].trim().slice(0, 40) : '';
    const guardianName = [v('guardianFamilyName'), v('guardianGivenName')].filter(Boolean).join(' ') || me.guardianName || '';
    const student = { ...s, familyName: v('familyName') || s.familyName, givenName: v('givenName') || s.givenName, grade: v('grade') || s.grade };
    const staffId = String(cond.proposedBy || '').replace(/^staff:/, '');
    const proposer = staffId ? await c.db.prepare('select name from staff where id = ?').bind(staffId).first() : null;
    return { html: conditionDocHtml({ cond, student, family: { ...me, guardianName }, terms: await termsForVersion(c.db, cond.termsVersion), proposer: proposer ? proposer.name : '', now: iso(c.now) }) };
  },
  // ③ 申し込む（共通規約と個別受講条件書への同意を含む）→ ④ そのまま入塾
  'family/enrollment/apply': async (c, b) => {
    const me = await requireFamily(c, b);
    if (b.agree !== true) fail('needAgree', '共通規約と個別受講条件書を確かめて「同意します」に印を付けてください');
    const terms = await applyTerms(c, b), x = await applyTarget(c, me, b.offerId, b.conditionId);
    const app = applicationFields(b), renewal = x.r.kind === 'renewal', now = iso(c.now);
    const evidence = consentEvidence(c, { consenterName: app.guardian.name }, me, me);
    // 体験のときの「◯◯さん」の表示名は、保護者の名字の「◯◯家」にする（代表が付けた名前は変えない）
    const surname = app.guardian.familyName, familyLabel = !renewal && me.name === x.s.familyName + 'さん' && surname ? surname + '家' : me.name;
    const one = applyStatements(c, me, x, app, terms, evidence);
    await c.db.batch([...one.stmts, familyUpdate(c, me, app, familyLabel, now), ...(me.termsVersion === terms.version ? [] : await termsConsentStatements(c, me.id, terms.version, { at: evidence.consentedAt, via: one.via, actorKind: 'family', actorId: me.id, note: '', evidence }))]);
    await storeDoc(c, x.cond.id); // 同意済みの個別受講条件書
    // 保護者にも受付のメール（2026-10-29 本人「入塾の手続きが完了した後に、保護者に通知が行ってない」）。控えは保護者ページの「契約・同意の控え」
    const sname = app.student.familyName + ' ' + app.student.givenName, enrolledOn = one.enrolledOn;
    if (renewal) await renewalMails(c, app.guardian.name, [{ x, app }]);
    else {
      await familyNotice(c, x.s.id, '入塾のお申込みを受け付けました', `${sname}さんの入塾のお申込みを受け付けました。ありがとうございます。
入塾日：${Number(enrolledOn.slice(5, 7))}月${Number(enrolledOn.slice(8))}日
${monthText(x.r.fromMonth)}からの授業の日程は、LINE などでご相談します。
同意した共通規約と個別受講条件書の控えは、保護者ページの「契約」でいつでも確かめられます。`, 'contracts');
      await staffNotice(c, `【入塾の申込み】${sname}さん`, `${sname}さん（${app.student.grade}）の入塾の申込みがありました。\n保護者：${app.guardian.name}\n開始：${monthText(x.r.fromMonth)}から（入塾日 ${enrolledOn}）\n共通規約・個別受講条件書（第${x.cond.no}版）に同意済みです。${monthText(x.r.fromMonth)}からの授業の日程を保護者と相談してください（まとまった回数の授業なら、受講計画書も作れます）。`);
    }
    await audit(c, renewal ? 'renewalApplied' : 'enrollmentApplied', x.r.id, { studentId: x.s.id, conditionId: x.cond.id, termsVersion: terms.version });
    return { enrollment: offerView(await getOffer(c, x.r.id)), enrolledOn };
  },
  // 契約更新の手続きは、兄弟をまとめて 1 回で（2026-10-30 本人「兄弟が複数人いるときに、２回同じ手順をやることに違和感」）。
  // 保護者の情報と共通規約は 1 回、生徒ごとの情報と個別受講条件書はまとめて確かめ、1 回の書き込みで同意する。受付のメールも 1 通
  'family/enrollment/apply-all': async (c, b) => {
    const me = await requireFamily(c, b);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 10) fail('badRequest', '同意する生徒がありません');
    if (b.agree !== true) fail('needAgree', '共通規約と個別受講条件書を確かめて「同意します」に印を付けてください');
    const terms = await applyTerms(c, b), xs = [];
    for (const it of items) xs.push(await applyTarget(c, me, it && it.offerId, it && it.conditionId));
    if (xs.some(x => x.r.kind !== 'renewal')) fail('badRequest', 'まとめて同意できるのは、契約更新の手続きだけです');
    if (new Set(xs.map(x => x.r.id)).size !== xs.length) fail('badRequest', '同じ生徒が 2 回入っています');
    const apps = items.map(it => applicationFields({ ...b, student: it.student })), now = iso(c.now);
    const evidence = consentEvidence(c, { consenterName: apps[0].guardian.name }, me, me);
    const all = xs.map((x, i) => applyStatements(c, me, x, apps[i], terms, evidence));
    await c.db.batch([...all.flatMap(o => o.stmts), familyUpdate(c, me, apps[0], me.name, now), ...(me.termsVersion === terms.version ? [] : await termsConsentStatements(c, me.id, terms.version, { at: evidence.consentedAt, via: all[0].via, actorKind: 'family', actorId: me.id, note: '', evidence }))]);
    for (const x of xs) await storeDoc(c, x.cond.id);
    await renewalMails(c, apps[0].guardian.name, xs.map((x, i) => ({ x, app: apps[i] })));
    for (const x of xs) await audit(c, 'renewalApplied', x.r.id, { studentId: x.s.id, conditionId: x.cond.id, termsVersion: terms.version, together: xs.length });
    return { enrollments: await Promise.all(xs.map(async x => offerView(await getOffer(c, x.r.id)))) };
  },
};
