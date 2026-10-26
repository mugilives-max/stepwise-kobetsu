// 入塾の案内と申込み（2026-10-18 本人決定。migrations-v2/0032_family_enrollment.sql）。
// 体験 → ① 代表が「入塾の案内を送る」（保護者のメールと受講条件。受講条件書の案ができ、招待のメールが届く）
//      → ② 保護者がパスワードを決める → ③ 保護者が 1 つの画面で申込み（保護者の情報・生徒の情報の確認・ご利用規約と受講条件書への同意）
//      → ④ そのまま入塾（体験の印を外し、代表にメール）。そのあとは毎月の受講合意書。
// - 申込みのあと代表の確認は挟まない（本人「そのまま入塾」）。受講条件は案内のときに代表が決める。
// - 申込みの内容（受講申込書の控え）は enrollmentOffers.application に残し、変えない（トリガー）。
// - 規約の同意・受講条件書の同意・申込み・入塾は 1 回の書き込み（batch）で行う。同意者名は保護者が入れた氏名。
import { fail, newId, iso, audit, normEmail, validEmail, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { issueChallenge } from './accounts.mjs';
import { familyNotice, staffNotice, todayJst } from './schedule.mjs';
import { currentTerms, termsConsentStatements } from './terms.mjs';
import { conditionFields, proposeCondition, studentConditions, storeDoc, MODE_LABEL } from './conditions.mjs';
import { consentEvidence } from './consent-evidence.mjs';
import { GRADES, normGrade } from '../../assets/v2/grade-options.js';

const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');
const monthText = m => m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const KANA = /^[ぁ-ゖァ-ヺー・\s　]+$/;
// 生徒の専用リンクの鍵（people.mjs と同じ作り）。MCP で登録した体験生の使えない鍵（off.）は、入塾のときに作り直す
const newLinkCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const offerView = r => r ? ({ id: r.id, familyId: r.familyId, studentId: r.studentId, conditionId: r.conditionId, fromMonth: r.fromMonth, status: r.status,
  offeredAt: r.offeredAt, offeredByName: r.offeredByName, appliedAt: r.appliedAt, consenterName: r.consenterName, termsVersion: r.termsVersion, withdrawnAt: r.withdrawnAt, version: r.version }) : null;

// 生徒の入塾の手続き（スタッフの生徒の画面・一覧で使う）。latest は最後の案内（取り消したものは除く）
export async function studentEnrollment(db, studentId) {
  const r = await db.prepare("select * from enrollmentOffers where studentId = ? and status <> 'withdrawn' order by offeredAt desc limit 1").bind(studentId).first();
  if (!r) return null;
  const v = offerView(r);
  if (r.status === 'applied') { try { v.application = JSON.parse(r.application); } catch {} }
  return v;
}
export async function enrollmentStates(db) {
  const rows = (await db.prepare("select studentId, status from enrollmentOffers where status = 'offered'").all()).results;
  return Object.fromEntries(rows.map(r => [r.studentId, r.status]));
}

async function getStudent(c, id) { const s = await c.db.prepare('select * from students where id = ?').bind(String(id || '')).first(); if (!s) fail('notFound', '生徒が見つかりません', 404); return s; }
async function getFamily(c, id) { const f = await c.db.prepare('select * from families where id = ?').bind(String(id || '')).first(); if (!f) fail('notFound', '家族が見つかりません', 404); return f; }
async function getOffer(c, id) { const r = await c.db.prepare('select * from enrollmentOffers where id = ?').bind(String(id || '')).first(); if (!r) fail('notFound', '入塾の案内が見つかりません', 404); return r; }

const inviteMail = (s, cond) => ({ subject: '【ステップワイズ】入塾のお手続きのご案内', body: url => `${fullName(s)}さんの保護者さま\n\nステップワイズ個別指導です。入塾のお手続きをご案内します。\n7日以内に次のリンクを開き、保護者ページのパスワードを決めてください。続けて、保護者さまの情報のご登録と、ご利用規約・受講条件書のご確認をお願いします。\n\n${url}\n\n保護者ページで「同意して入塾を申し込む」を押すと、お申込みが完了します。\nリンクの期限が切れた場合は、いつものLINEまたは mugilives@gmail.com へご連絡ください。\n心当たりがない場合は、このメールを破棄してください。` });
const activeText = (s, cond) => `${fullName(s)}さんの入塾のお手続きをご案内します。保護者ページの「入塾のお申込み」で、保護者さまの情報とご利用規約・受講条件書をご確認のうえ、お申し込みください。`; // 料金などは申込みの画面で（2026-10-26 本人「料金とかはこの段階では見せなくていい」）

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

export const enrollmentRoutes = {
  // ① 入塾の案内を送る（体験生）。保護者のメールと受講条件を入れる
  'admin/enrollment/offer': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const s = await getStudent(c, b.studentId);
    if (!s.trial) fail('notTrial', 'この生徒はもう入塾しています');
    if (s.status === 'left') fail('left', '退会した生徒には案内できません');
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('needTerms', '先に「設定 → ご利用規約」で、ご利用規約を使い始めてください。保護者は申込みのときに規約に同意します', 409);
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
  // 案内をもう一度送る（リンクの期限切れ・メールが届かない）
  'admin/enrollment/resend': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const r = await getOffer(c, b.offerId);
    if (r.status !== 'offered') fail('closed', 'この案内はもう申し込まれたか、取り消されています', 409);
    const s = await getStudent(c, r.studentId), f = await getFamily(c, r.familyId);
    const cond = await c.db.prepare('select * from conditions where id = ?').bind(r.conditionId).first();
    const sent = await sendOffer(c, f, s, cond);
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
  // 申込みの画面に出すもの: 案内（生徒・受講条件書）、今のご利用規約、保護者の今の情報
  'family/enrollment': async (c, b) => {
    const me = await requireFamily(c, b);
    const rows = (await c.db.prepare("select * from enrollmentOffers where familyId = ? and status in ('offered', 'applied') order by offeredAt").bind(me.id).all()).results;
    const offers = [];
    for (const r of rows) {
      if (r.status === 'applied' && r.appliedAt < iso(c.now - 14 * 86400e3)) continue; // 申し込んだものは 2 週間だけ「済み」として見せる
      const s = await getStudent(c, r.studentId), conds = await studentConditions(c.db, s.id);
      const cond = (conds.history || []).find(x => x.id === r.conditionId) || null;
      offers.push({ ...offerView(r), student: { id: s.id, familyName: s.familyName, givenName: s.givenName, familyKana: s.familyKana, givenKana: s.givenKana, grade: s.grade, school: s.school, name: fullName(s) }, condition: cond });
    }
    const zip = /^〒(\d{3}-\d{4}) ?(.*)$/.exec(me.address || '');
    // 姓・名を分けて持つ前の家族は、「姓 名」の空白で分けて最初の値にする
    const split = v => { const m = /^(\S+)[\s　]+(.+)$/.exec(String(v || '').trim()); return m ? [m[1], m[2]] : [String(v || '').trim(), '']; };
    const [nf, ng] = me.guardianFamilyName || me.guardianGivenName ? [me.guardianFamilyName, me.guardianGivenName] : split(me.guardianName);
    const [kf, kg] = me.guardianFamilyKana || me.guardianGivenKana ? [me.guardianFamilyKana, me.guardianGivenKana] : split(me.guardianKana);
    return { offers, terms: await currentTerms(c.db),
      guardian: { familyName: nf || '', givenName: ng || '', familyKana: kf || '', givenKana: kg || '', phone: me.phone || '', zip: zip ? zip[1] : '', address: zip ? zip[2] : (me.address || ''), email: me.email } };
  },
  // ③ 申し込む（ご利用規約と受講条件書への同意を含む）→ ④ そのまま入塾
  'family/enrollment/apply': async (c, b) => {
    const me = await requireFamily(c, b);
    const r = await getOffer(c, b.offerId);
    if (r.familyId !== me.id) fail('notFound', '入塾の案内が見つかりません', 404);
    if (r.status !== 'offered') fail('closed', r.status === 'applied' ? 'お申込みはもう完了しています' : 'この案内は取り消されました。教室にお問い合わせください', 409);
    if (b.agree !== true) fail('needAgree', 'ご利用規約と受講条件書を確かめて「同意します」に印を付けてください');
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('noTerms', 'ご利用規約の準備ができていません。教室にお問い合わせください', 409);
    if (String(b.termsVersion || '') !== terms.version) fail('staleVersion', 'ご利用規約が新しくなっています。画面を更新して、もう一度確かめてください', 409);
    const cond = await c.db.prepare('select * from conditions where id = ?').bind(r.conditionId).first();
    if (String(b.conditionId || '') !== r.conditionId || !cond || cond.status !== 'proposed') fail('staleCondition', '受講条件書が変わりました。画面を更新して、もう一度確かめてください', 409);
    const s = await getStudent(c, r.studentId), app = applicationFields(b);
    const evidence = consentEvidence(c, { consenterName: app.guardian.name }, me, me), now = iso(c.now), at = evidence.consentedAt;
    const today = todayJst(c.now), enrolledOn = r.fromMonth + '-01' > today ? r.fromMonth + '-01' : today;
    const snapshot = { appliedAt: now, guardian: { ...app.guardian, email: me.email }, student: app.student,
      condition: { id: cond.id, no: cond.no, minutes: cond.minutes, fee: cond.fee, deliveryMode: cond.deliveryMode, subjects: cond.subjects, note: cond.note, fromMonth: cond.fromMonth },
      terms: { version: terms.version, title: terms.title, url: terms.url }, enrolledOn };
    const json = JSON.stringify(snapshot), surname = app.guardian.familyName;
    // 体験のときの「◯◯さん」の表示名は、保護者の名字の「◯◯家」にする（代表が付けた名前は変えない）
    const familyLabel = me.name === s.familyName + 'さん' && surname ? surname + '家' : me.name;
    await c.db.batch([
      c.db.prepare("update enrollmentOffers set status = 'applied', appliedAt = ?, application = ?, contentHash = ?, termsVersion = ?, consenterName = ?, version = version + 1 where id = ? and status = 'offered'")
        .bind(now, json, sha256Hex(json), terms.version, evidence.consenterName, r.id),
      c.db.prepare('update families set name = ?, guardianName = ?, guardianKana = ?, guardianFamilyName = ?, guardianGivenName = ?, guardianFamilyKana = ?, guardianGivenKana = ?, phone = ?, address = ?, updatedAt = ?, version = version + 1 where id = ?')
        .bind(familyLabel, app.guardian.name, app.guardian.kana, app.guardian.familyName, app.guardian.givenName, app.guardian.familyKana, app.guardian.givenKana, app.guardian.phone, app.guardian.address, now, me.id),
      c.db.prepare("update students set familyName = ?, givenName = ?, familyKana = ?, givenKana = ?, grade = ?, school = ?, trial = 0, enrolledOn = ?, linkCode = case when linkCode like 'off.%' then ? else linkCode end, updatedAt = ?, version = version + 1 where id = ?")
        .bind(app.student.familyName, app.student.givenName, app.student.familyKana, app.student.givenKana, app.student.grade, app.student.school, enrolledOn, newLinkCode(), now, s.id),
      c.db.prepare("update conditions set status = 'agreed', agreedAt = ?, agreedVia = ?, agreedBy = ?, agreedNote = ?, consenterName = ?, recordedAt = ?, recordedByName = ?, updatedAt = ? where id = ? and status = 'proposed'")
        .bind(at, '保護者ページ（入塾の申込み）', 'family:' + me.id, '', evidence.consenterName, evidence.recordedAt, evidence.recordedByName, now, cond.id),
      ...(me.termsVersion === terms.version ? [] : await termsConsentStatements(c, me.id, terms.version, { at, via: '保護者ページ（入塾の申込み）', actorKind: 'family', actorId: me.id, note: '', evidence })),
    ]);
    await storeDoc(c, cond.id); // 同意済みの受講条件書
    const name = app.student.familyName + ' ' + app.student.givenName;
    await staffNotice(c, `【入塾の申込み】${name}さん`, `${name}さん（${app.student.grade}）の入塾の申込みがありました。\n保護者：${app.guardian.name}\n開始：${monthText(r.fromMonth)}から（入塾日 ${enrolledOn}）\nご利用規約・受講条件書（第${cond.no}版）に同意済みです。${monthText(r.fromMonth)}の計画（受講合意書）を作って送ってください。`);
    await audit(c, 'enrollmentApplied', r.id, { studentId: s.id, conditionId: cond.id, termsVersion: terms.version });
    return { enrollment: offerView(await getOffer(c, r.id)), enrolledOn };
  },
};
