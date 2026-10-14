// MCP からの書き込み（2026-10-13、Kura の reference/stepwise-mcp-write-claude-handoff.md）。
// 予定の保存と、選んだ授業だけのお知らせを分ける。きっかけ: 体験授業の登録で別の生徒を選び、その場でメールが届いてしまった（取り戻せない）。
//
//  1. mcp/lessons/save     … 授業をまとめて未送信（held）で保存する。メール・カレンダーは 0。dryRun で何も書かずに判定だけ。requestId で冪等
//  2. mcp/lessons/get      … 保存した授業を ID で読み戻す（お知らせの履歴つき）
//  3. mcp/lessons/fix      … 未送信の授業だけ直す（生徒の付け替えも可）。版（version）が合うときだけ
//  4. mcp/notices/preview  … 選んだ授業 ID だけについて、生徒・宛先（伏せ字）・メールの数・状態の変わり方を見せ、確認値（confirm）を返す
//  5. mcp/notices/send     … 確認値が今の状態と合うときだけ、選んだ授業だけを送る。体験生の授業はメールなしで決定（カレンダー）
//  6. mcp/lessons/reschedule … 日程の変更。未送信なら黙って直す。送ったあとの授業は、お知らせ・カレンダーをプレビューして確認値が合うときだけ
//  7. mcp/trials/create    … 体験生の登録。専用リンク（生徒ページへの永続アクセス）は作らない（off. の鍵。管理画面で作り直すまで使えない）
//  8. mcp/requests/get     … requestId の結果と、送ったメールの今の状態
//
// 入口は Worker の別の鍵（V2_SERVICE_WRITE_KEY。読み取りの V2_SERVICE_KEY とは別）で、mcp/ の道だけを通す（cf/v2/service.mjs）。
// 対象は V2_SERVICE_WRITE_SCOPE が 'all' でなければ「テスト用の生徒」（testOnly か名字が【テスト】）だけ。
// 請求・料金・契約・同意の代行・支払い・削除・汎用の管理 API の直通は無い。既定のお知らせはしない（送るのは notices/send だけ）。
import { fail, audit, newId, iso, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { recordEffects } from './effects.mjs';
import { scheduleRoutes, checkConflicts, lessonFields, lessonView, familyNotice, calendarEffect, confirmByFor, todayJst, freeDeadline, isCalMarker } from './schedule.mjs';

const MAX_ITEMS = 30;
const RID = /^[A-Za-z0-9._:-]{8,80}$/, KEY = /^[A-Za-z0-9._:-]{1,40}$/;
const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');
const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const endOf = (start, minutes) => { const t = toMin(start) + Number(minutes); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
const overlap = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.start) + Number(b.minutes) && toMin(b.start) < toMin(a.start) + Number(a.minutes);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const mdw = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
const hash = v => sha256Hex(JSON.stringify(v));
// 宛先は伏せ字（先頭 2 文字とドメインだけ）
export const maskEmail = e => { const [u, d] = String(e || '').split('@'); return d ? (u.slice(0, 2) + '***@' + d) : ''; };

// ---- 対象の範囲 ----
const scopeOf = c => (String(c.env.V2_SERVICE_WRITE_SCOPE || '') === 'all' ? 'all' : 'test');
const isTestStudent = (s, fam) => !!s.testOnly || !!(fam && fam.testOnly) || /^【テスト】/.test(String(s.familyName || ''));
async function studentWithFamily(c, id) {
  const s = await c.db.prepare('select s.*, f.name familyLabel, f.email familyEmail, f.status familyStatus, f.testOnly familyTestOnly from students s join families f on f.id = s.familyId where s.id = ?').bind(String(id || '')).first();
  if (!s) fail('notFound', '生徒が見つかりません', 404);
  return s;
}
function checkScope(c, s) {
  if (!c.serviceWrite) return; // スタッフの画面から呼んだときは範囲を絞らない
  if (scopeOf(c) === 'test' && !isTestStudent(s, { testOnly: s.familyTestOnly })) fail('outOfScope', 'いまはテスト用の生徒（名字が【テスト】）だけ登録できます（V2_SERVICE_WRITE_SCOPE）', 403);
}
const studentLabel = s => ({ id: s.id, name: fullName(s), grade: s.grade, trial: !!s.trial });

// ---- 冪等の記録 ----
async function beginRequest(c, requestId, kind, input) {
  if (!RID.test(String(requestId || ''))) fail('badRequestId', 'requestId（8〜80文字の英数字と ._:-）を付けてください');
  const h = hash(input), now = iso(c.now);
  await c.db.prepare("insert into mcpRequests (requestId, kind, inputHash, status, actorId, createdAt, updatedAt) values (?, ?, ?, 'running', ?, ?, ?) on conflict(requestId) do nothing")
    .bind(requestId, kind, h, c.actor ? c.actor.id : '', now, now).run();
  const row = await c.db.prepare('select * from mcpRequests where requestId = ?').bind(requestId).first();
  if (row.kind !== kind || row.inputHash !== h) fail('requestMismatch', 'この requestId は別の内容で使われています。新しい requestId で依頼してください', 409);
  return row;
}
async function finishRequest(c, requestId, status, result) {
  await c.db.prepare('update mcpRequests set status = ?, result = ?, updatedAt = ? where requestId = ?').bind(status, JSON.stringify(result), iso(c.now), requestId).run();
}
const parse = s => { try { return JSON.parse(s) || {}; } catch { return {}; } };

// ---- 読み戻し ----
async function noticesOf(c, lessonIds) {
  if (!lessonIds.length) return [];
  const rows = (await c.db.prepare(`select n.*, e.status effectStatus, e.error effectError, e.sentAt from lessonNotices n left join effects e on e.id = n.effectId where n.lessonId in (${lessonIds.map(() => '?').join(', ')}) order by n.createdAt`).bind(...lessonIds).all()).results;
  return rows.map(n => ({ lessonId: n.lessonId, requestId: n.requestId, action: n.action, to: n.toMasked, mail: n.effectId ? (n.effectStatus || 'unknown') : 'none', sentAt: n.sentAt || '', at: n.createdAt }));
}
async function readLessons(c, ids) {
  if (!ids.length) return [];
  const rows = (await c.db.prepare(`select l.*, s.familyName, s.givenName, s.trial from lessons l join students s on s.id = l.studentId where l.id in (${ids.map(() => '?').join(', ')}) order by l.date, l.start`).bind(...ids).all()).results;
  const notes = await noticesOf(c, rows.map(r => r.id));
  return rows.map(l => lessonView(l, { studentName: fullName(l), trial: !!l.trial, end: endOf(l.start, l.minutes), unsent: l.status === 'held', notices: notes.filter(n => n.lessonId === l.id) }));
}

// ---- 保存の判定（1 件） ----
async function judgeItem(c, item, accepted, today) {
  let s;
  try { s = await studentWithFamily(c, item.studentId); } catch (e) { return { status: 'invalid', error: '生徒が見つかりません' }; }
  try { checkScope(c, s); } catch (e) { return { status: 'invalid', error: e.message }; }
  if (s.status === 'left') return { status: 'invalid', error: '退会した生徒には登録できません' };
  let n;
  try { n = lessonFields({ date: item.date, start: item.start, minutes: item.minutes, subject: item.subject, kind: s.trial ? '体験' : item.kind, deliveryMode: item.deliveryMode || s.deliveryMode || 'in_person', staffId: item.staffId || c.actor.id }); }
  catch (e) { return { status: 'invalid', error: e.message }; }
  if (n.date < today) return { status: 'invalid', error: '過去の日付は登録できません（実施済みの授業は管理画面の「実施した授業を登録」）' };
  const cand = { ...n, studentId: s.id };
  if (accepted.some(a => a.studentId === s.id && overlap(a, cand))) return { status: 'conflict', error: `${n.date} ${n.start} は同じ依頼のほかの授業と重なっています` };
  try { await checkConflicts(c, [cand], { force: item.force === true }); }
  catch (e) { return { status: e.extra && e.extra.needForce ? 'needsConfirm' : 'conflict', error: e.message }; }
  return { status: 'ok', student: s, lesson: cand };
}
const itemPreview = (j, item) => j.status === 'ok' ? { student: studentLabel(j.student), date: j.lesson.date, start: j.lesson.start, end: endOf(j.lesson.start, j.lesson.minutes), minutes: j.lesson.minutes, subject: j.lesson.subject, kind: j.lesson.kind, deliveryMode: j.lesson.deliveryMode, staffId: j.lesson.staffId,
  saveAs: '未送信（held）。保護者にも生徒にも見えない。メール・カレンダーは 0。送るのは notices/send で選んだときだけ' } : { studentId: item.studentId, date: item.date, start: item.start };

// ---- お知らせの計画（プレビューと送信で同じものを作る） ----
async function noticePlan(c, b) {
  const ids = Array.isArray(b.lessonIds) ? b.lessonIds.map(String) : [];
  const studentIds = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
  if (!ids.length || ids.length > MAX_ITEMS) fail('needIds', `お知らせする授業の ID を 1〜${MAX_ITEMS} 件、lessonIds で選んでください`);
  if (!studentIds.length) fail('needStudents', '対象の生徒の ID を studentIds で示してください（選んだ授業がほかの生徒のものなら止めます）');
  if (new Set(ids).size !== ids.length) fail('duplicate', '同じ授業の ID が 2 回入っています');
  const rows = (await c.db.prepare(`select * from lessons where id in (${ids.map(() => '?').join(', ')})`).bind(...ids).all()).results;
  const problems = [];
  for (const id of ids) {
    const l = rows.find(r => r.id === id);
    if (!l) { problems.push({ lessonId: id, problem: 'notFound', message: '授業が見つかりません' }); continue; }
    if (!studentIds.includes(l.studentId)) problems.push({ lessonId: id, problem: 'otherStudent', message: '選んだ生徒の授業ではありません' });
    if (l.status !== 'held') problems.push({ lessonId: id, problem: 'notUnsent', message: l.status === 'proposed' || l.status === 'decided' ? 'もうお知らせした授業です（二重には送りません）' : 'お知らせできない状態の授業です' });
  }
  const students = {};
  for (const sid of [...new Set(rows.map(r => r.studentId))]) {
    const s = await studentWithFamily(c, sid);
    try { checkScope(c, s); } catch (e) { problems.push({ studentId: sid, problem: 'outOfScope', message: e.message }); }
    students[sid] = s;
  }
  if (problems.length) fail('badTargets', '選んだ授業に送れないものがあります（何も送っていません）', 409, { problems });
  const today = todayJst(c.now), lessons = ids.map(id => rows.find(r => r.id === id)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const targets = [], mails = [];
  for (const sid of Object.keys(students)) {
    const s = students[sid], mine = lessons.filter(l => l.studentId === sid);
    if (s.trial) {
      for (const l of mine) targets.push({ lessonId: l.id, version: l.version, student: studentLabel(s), date: l.date, start: l.start, end: endOf(l.start, l.minutes), subject: l.subject, kind: l.kind, action: 'decideTrial', becomes: 'decided', effect: '体験の授業を決定にして Google カレンダーに入れる（メールなし）' });
      continue;
    }
    const bys = confirmByFor(mine.map(l => l.date), today, '');
    mine.forEach((l, i) => targets.push({ lessonId: l.id, version: l.version, student: studentLabel(s), date: l.date, start: l.start, end: endOf(l.start, l.minutes), subject: l.subject, kind: l.kind, action: 'propose', becomes: 'proposed', confirmBy: bys[i], effect: bys[i] ? `仮予定として保護者ページに出す（${mdw(bys[i])}までに連絡がなければ決定）` : '仮予定として保護者ページに出す（締め切りなし。決定は管理画面で）' }));
    const willSend = !!s.familyEmail && s.familyStatus === 'active' && !s.familyTestOnly && !s.testOnly;
    const reason = willSend ? '' : !s.familyEmail ? '家族のメールが無い' : s.familyStatus !== 'active' ? '保護者ページの登録がまだ' : 'テスト用の家族（送らない）';
    const lines = mine.map((l, i) => `・${mdw(l.date)} ${l.start}〜${endOf(l.start, l.minutes)} ${l.subject}${l.kind && l.kind !== '通常' ? '（' + l.kind + '）' : ''}`);
    const by = bys.filter(Boolean).sort()[0];
    mails.push({ studentId: sid, student: studentLabel(s), to: maskEmail(s.familyEmail), willSend, reason, subject: '【ステップワイズ】授業の仮予定が届いています',
      body: `${fullName(s)}さんの授業の仮予定をお送りします。\n${lines.join('\n')}\n${by ? `${mdw(by)}までに連絡がなければ、この日時で決定します。` : '日時のご都合が悪ければご連絡ください。'}`, lessonIds: mine.map(l => l.id) });
  }
  // 選ばれていない未送信の授業（同じ生徒）。送らないことを見せる
  const left = (await c.db.prepare(`select count(*) n from lessons where status = 'held' and studentId in (${Object.keys(students).map(() => '?').join(', ')}) and id not in (${ids.map(() => '?').join(', ')})`).bind(...Object.keys(students), ...ids).first()).n;
  const mailCount = mails.filter(m => m.willSend).length;
  const confirm = hash({ t: targets.map(t => [t.lessonId, t.version, t.action, t.student.id, t.confirmBy || '']), m: mails.map(m => [m.studentId, m.to, m.willSend, m.body]) }).slice(0, 32);
  return { targets, mails, mailCount, otherUnsent: Number(left || 0), confirm, students };
}
const planView = p => ({ targets: p.targets, mails: p.mails.map(({ studentId, ...m }) => m), mailCount: p.mailCount, otherUnsent: p.otherUnsent, confirm: p.confirm,
  note: `選んだ ${p.targets.length} 件だけが対象です（同じ生徒のほかの未送信 ${p.otherUnsent} 件は送りません）。メールは ${p.mailCount} 通。` });

// 送ったメールの今の状態
async function mailStatus(c, effectIds) {
  const ids = effectIds.filter(Boolean);
  if (!ids.length) return [];
  return (await c.db.prepare(`select id, status, error, sentAt from effects where id in (${ids.map(() => '?').join(', ')})`).bind(...ids).all()).results.map(e => ({ effectId: e.id, status: e.status, sentAt: e.sentAt || '', error: e.status === 'failed' ? String(e.error || '').slice(0, 120) : '' }));
}
// c.effects に積んだ家族あてのメールを、ここで記録して ID を受け取る（配達は入口が c.queued から行う）
async function takeMails(c) {
  const mine = c.effects.filter(e => e.kind === 'mail' && e.audience === 'family');
  c.effects = c.effects.filter(e => !(e.kind === 'mail' && e.audience === 'family'));
  if (!mine.length) return [];
  const queued = await recordEffects(c.db, mine, c.now); // 送らないもの（テスト用・切り替え前）は dismissed で、ここには入らない
  c.queued = (c.queued || []).concat(queued);
  return queued.map(q => q.id);
}

export const mcpWriteRoutes = {
  'mcp/lessons/save': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > MAX_ITEMS) fail('badItems', `授業は 1〜${MAX_ITEMS} 件にしてください`);
    const keys = items.map(x => String((x && x.key) || ''));
    if (keys.some(k => !KEY.test(k))) fail('badKey', '各授業に key（1〜40文字の英数字と ._:-）を付けてください（再実行のときに同じ授業だと分かるように）');
    if (new Set(keys).size !== keys.length) fail('duplicateKey', '同じ key が 2 つあります');
    const today = todayJst(c.now), dry = b.dryRun === true;
    if (!dry) {
      const req = await beginRequest(c, b.requestId, 'lessonsSave', items);
      if (req.status === 'done') { const r = parse(req.result); return { ...r, repeated: true, lessons: await readLessons(c, (r.items || []).map(i => i.lessonId).filter(Boolean)) }; }
    }
    const out = [], accepted = [];
    for (const item of items) {
      const key = String(item.key);
      if (!dry) {
        const had = await c.db.prepare('select * from mcpRequestItems where requestId = ? and itemKey = ?').bind(b.requestId, key).first();
        if (had) { out.push({ key, status: 'exists', lessonId: had.lessonId }); const l = await c.db.prepare('select * from lessons where id = ?').bind(had.lessonId).first(); if (l) accepted.push(l); continue; }
      }
      const j = await judgeItem(c, item, accepted, today);
      if (j.status !== 'ok') { out.push({ key, status: j.status, error: j.error, ...itemPreview(j, item) }); continue; }
      accepted.push(j.lesson);
      if (dry) { out.push({ key, status: 'wouldCreate', ...itemPreview(j, item) }); continue; }
      const id = newId('ls'), now = iso(c.now), x = j.lesson;
      try {
        await c.db.batch([
          c.db.prepare('insert into mcpRequestItems (requestId, itemKey, inputHash, lessonId, createdAt) values (?, ?, ?, ?, ?)').bind(b.requestId, key, hash(item), id, now),
          c.db.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, confirmBy, note, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', '', ?, ?, ?)")
            .bind(id, x.studentId, x.staffId, x.date, x.start, x.minutes, x.subject, x.kind, x.deliveryMode, 'MCP で保存（' + String(b.requestId).slice(0, 40) + '）', now, now),
        ]);
        out.push({ key, status: 'created', lessonId: id, ...itemPreview(j, item) });
      } catch (e) {
        // 同時に同じ項目を作った（主キーの重なり）。作られた方を返す
        const had = await c.db.prepare('select * from mcpRequestItems where requestId = ? and itemKey = ?').bind(b.requestId, key).first();
        if (had) out.push({ key, status: 'exists', lessonId: had.lessonId });
        else out.push({ key, status: 'failed', error: '保存に失敗しました。requests/get で確かめてから、同じ requestId で再実行してください' });
      }
    }
    const result = { dryRun: dry, requestId: dry ? '' : b.requestId, items: out, mails: 0,
      counts: Object.fromEntries(['created', 'exists', 'wouldCreate', 'needsConfirm', 'conflict', 'invalid', 'failed'].map(k => [k, out.filter(o => o.status === k).length])) };
    if (dry) return result;
    const allDone = out.every(o => ['created', 'exists'].includes(o.status));
    await finishRequest(c, b.requestId, allDone ? 'done' : 'running', result); // 一部が通らなかったら、直して同じ requestId で続きを出せる（作った分は作り直さない）… 入力が変わると requestMismatch になるので、続きは新しい requestId で
    await audit(c, 'mcpLessonsSave', '', { requestId: b.requestId, created: result.counts.created, exists: result.counts.exists });
    return { ...result, lessons: await readLessons(c, out.map(o => o.lessonId).filter(Boolean)) };
  },

  'mcp/lessons/get': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const ids = Array.isArray(b.lessonIds) ? [...new Set(b.lessonIds.map(String))].slice(0, 60) : [];
    if (!ids.length) fail('needIds', 'lessonIds を指定してください');
    const lessons = await readLessons(c, ids);
    return { lessons, missing: ids.filter(id => !lessons.some(l => l.id === id)) };
  },

  'mcp/lessons/fix': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await c.db.prepare('select * from lessons where id = ?').bind(String(b.lessonId || '')).first();
    if (!l) fail('notFound', '授業が見つかりません', 404);
    if (Number(b.version) !== Number(l.version)) fail('conflict', 'ほかの操作で変わりました。lessons/get で読み直してください', 409);
    if (l.status !== 'held') fail('notUnsent', '直せるのは未送信の授業だけです（送ったあとの変更は reschedule、生徒の付け替えは管理画面で）', 409);
    const before = await studentWithFamily(c, l.studentId); checkScope(c, before);
    const s = b.studentId ? await studentWithFamily(c, b.studentId) : before; checkScope(c, s);
    if (s.status === 'left') fail('left', '退会した生徒には付け替えられません');
    const n = lessonFields({ ...b, kind: s.trial ? '体験' : (b.kind ?? (before.trial && !s.trial ? '通常' : l.kind)) }, l);
    if (n.date < todayJst(c.now)) fail('past', '過去の日付にはできません');
    await checkConflicts(c, [{ ...n, studentId: s.id }], { force: b.force === true, exceptId: l.id });
    const after = { studentId: s.id, date: n.date, start: n.start, minutes: n.minutes, subject: n.subject, kind: n.kind, deliveryMode: n.deliveryMode, staffId: n.staffId };
    const diff = Object.fromEntries(Object.entries(after).filter(([k, v]) => String(v) !== String(l[k])).map(([k, v]) => [k, { before: l[k], after: v }]));
    if (b.dryRun === true) return { dryRun: true, lessonId: l.id, changes: diff, mails: 0, student: studentLabel(s) };
    const r = await c.db.prepare("update lessons set studentId = ?, date = ?, start = ?, minutes = ?, subject = ?, kind = ?, deliveryMode = ?, staffId = ?, updatedAt = ?, version = version + 1 where id = ? and version = ? and status = 'held'")
      .bind(after.studentId, after.date, after.start, after.minutes, after.subject, after.kind, after.deliveryMode, after.staffId, iso(c.now), l.id, l.version).run();
    if (!r.meta || !r.meta.changes) fail('conflict', 'ほかの操作で変わりました。lessons/get で読み直してください', 409);
    await audit(c, 'mcpLessonFix', l.id, { changes: Object.keys(diff) });
    return { lessonId: l.id, changes: diff, mails: 0, lesson: (await readLessons(c, [l.id]))[0] };
  },

  'mcp/notices/preview': async (c, b) => {
    await requireStaff(c, b, 'manager');
    return planView(await noticePlan(c, b));
  },

  'mcp/notices/send': async (c, b) => {
    await requireStaff(c, b, 'manager');
    if (!b.confirm) fail('needConfirm', '先に notices/preview で確かめ、その confirm を付けて送ってください');
    const input = { lessonIds: (b.lessonIds || []).map(String).sort(), studentIds: (b.studentIds || []).map(String).sort(), confirm: String(b.confirm) };
    const req = await beginRequest(c, b.requestId, 'notice', input);
    if (req.status === 'done') { const r = parse(req.result); return { ...r, repeated: true, mailsNow: await mailStatus(c, (r.mails || []).map(m => m.effectId)) }; }
    if (req.status === 'failed') fail('requestFailed', 'この requestId の送信は止まりました（' + (parse(req.result).error || '') + '）。preview からやり直し、新しい requestId で送ってください', 409);
    let plan;
    try { plan = await noticePlan(c, b); }
    catch (e) { await finishRequest(c, b.requestId, 'failed', { error: e.message }); throw e; }
    if (plan.confirm !== String(b.confirm)) { await finishRequest(c, b.requestId, 'failed', { error: 'stale' }); fail('stale', 'プレビューのあとで対象が変わりました。もう一度 notices/preview で確かめてください（何も送っていません）', 409); }
    const now = iso(c.now), today = todayJst(c.now);
    // 状態を変える（版と未送信の両方が合うものだけ）。全部が合わなければ何も変えない
    const ups = plan.targets.map(t => t.action === 'decideTrial'
      ? c.db.prepare("update lessons set status = 'decided', decidedAt = ?, decidedBy = ?, updatedAt = ?, version = version + 1 where id = ? and version = ? and status = 'held'").bind(now, 'staff:' + c.actor.id, now, t.lessonId, t.version)
      : c.db.prepare("update lessons set status = 'proposed', confirmBy = ?, updatedAt = ?, version = version + 1 where id = ? and version = ? and status = 'held'").bind(t.confirmBy || '', now, t.lessonId, t.version));
    const res = await c.db.batch(ups);
    if (res.some(r => !r.meta || !r.meta.changes)) {
      await c.db.batch(plan.targets.map((t, i) => res[i] && res[i].meta && res[i].meta.changes ? c.db.prepare("update lessons set status = 'held', confirmBy = '', decidedAt = '', decidedBy = '', updatedAt = ?, version = version + 1 where id = ?").bind(now, t.lessonId) : null).filter(Boolean));
      await finishRequest(c, b.requestId, 'failed', { error: 'raced' });
      fail('stale', '送る直前にほかの操作で変わりました。もう一度 notices/preview で確かめてください（何も送っていません）', 409);
    }
    // 体験はカレンダーへ（メールなし）
    for (const t of plan.targets.filter(t => t.action === 'decideTrial')) {
      const l = await c.db.prepare('select * from lessons where id = ?').bind(t.lessonId).first();
      const marker = await calendarEffect(c, 'create', l, t.student.name);
      await c.db.prepare('update lessons set calendarEventId = ? where id = ?').bind(marker, l.id).run();
    }
    // 家族あてのメール（生徒ごとに 1 通。宛先の無い家族には送らない）
    const mails = [];
    for (const m of plan.mails) {
      let effectId = null;
      if (m.willSend) {
        await familyNotice(c, m.studentId, '授業の仮予定が届いています', m.body);
        effectId = (await takeMails(c))[0] || null;
      }
      mails.push({ student: m.student.name, to: m.to, effectId, status: m.willSend ? (effectId ? 'queued' : 'notQueued') : 'notSent', reason: m.reason, lessonIds: m.lessonIds });
    }
    const notes = plan.targets.map(t => {
      const m = mails.find(x => x.lessonIds.includes(t.lessonId));
      return c.db.prepare('insert into lessonNotices (id, requestId, lessonId, studentId, action, effectId, toMasked, createdAt) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(newId('ln'), b.requestId, t.lessonId, t.student.id, t.action, m ? m.effectId : null, m ? m.to : '', now);
    });
    if (notes.length) await c.db.batch(notes);
    const result = { requestId: b.requestId, sentLessons: plan.targets.map(t => ({ lessonId: t.lessonId, student: t.student.name, date: t.date, start: t.start, becomes: t.becomes })), mails, mailCount: mails.filter(m => m.effectId).length,
      note: 'メールは送信の控え（effects）に入りました。届いたかは requests/get で確かめてください（status: sent / failed / pending）。送れなかったものを自動で再送はしません（送信の記録で送り直す）。' };
    await finishRequest(c, b.requestId, 'done', result);
    await audit(c, 'mcpNoticeSend', '', { requestId: b.requestId, lessons: plan.targets.length, mails: result.mailCount, today });
    return result;
  },

  'mcp/lessons/reschedule': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await c.db.prepare('select * from lessons where id = ?').bind(String(b.lessonId || '')).first();
    if (!l) fail('notFound', '授業が見つかりません', 404);
    if (Number(b.version) !== Number(l.version)) fail('conflict', 'ほかの操作で変わりました。lessons/get で読み直してください', 409);
    if (!['held', 'proposed', 'decided'].includes(l.status)) fail('badStatus', 'この授業は日程を変えられません');
    const s = await studentWithFamily(c, l.studentId); checkScope(c, s);
    if (l.status === 'decided' && c.now > freeDeadline(l.date)) fail('late', '前日23時を過ぎた決定の授業の変更は、取消料の判断が要るので管理画面でしてください', 409);
    const n = lessonFields({ date: b.date, start: b.start, minutes: b.minutes }, l);
    if (n.date < todayJst(c.now)) fail('past', '過去の日付にはできません');
    await checkConflicts(c, [{ ...n, studentId: l.studentId }], { force: false, exceptId: l.id });
    const mail = l.status !== 'held' && !!s.familyEmail && s.familyStatus === 'active' && !s.familyTestOnly && !s.testOnly;
    const preview = { lessonId: l.id, student: studentLabel(s), before: { date: l.date, start: l.start, minutes: l.minutes }, after: { date: n.date, start: n.start, minutes: n.minutes }, status: l.status,
      effects: { mails: mail ? 1 : 0, to: mail ? maskEmail(s.familyEmail) : '', calendar: l.status === 'decided' ? 'patch' : 'none', cancelFee: 'none' } };
    const confirm = hash({ ...preview, version: l.version }).slice(0, 32);
    if (b.dryRun === true) return { dryRun: true, ...preview, confirm, note: l.status === 'held' ? '未送信の授業なので、メールもカレンダーも動きません' : '送ったあとの授業なので、保護者に日時の変更のお知らせが届きます。確かめてから confirm を付けて実行してください' };
    if (l.status !== 'held' && String(b.confirm || '') !== confirm) fail('needConfirm', '送ったあとの授業の変更は、先に dryRun で確かめ、その confirm を付けて実行してください（何も変えていません）', 409);
    const req = await beginRequest(c, b.requestId, 'reschedule', { lessonId: l.id, version: l.version, date: n.date, start: n.start, minutes: n.minutes });
    if (req.status === 'done') return { ...parse(req.result), repeated: true };
    const r = await scheduleRoutes['schedule/lessons/update'](c, { id: l.id, version: l.version, date: n.date, start: n.start, minutes: n.minutes });
    const ids = await takeMails(c);
    if (ids.length) await c.db.prepare('insert into lessonNotices (id, requestId, lessonId, studentId, action, effectId, toMasked, createdAt) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(newId('ln'), b.requestId, l.id, l.studentId, 'reschedule', ids[0], maskEmail(s.familyEmail), iso(c.now)).run();
    const result = { requestId: b.requestId, lesson: r.lesson, mails: ids.map(id => ({ effectId: id, to: maskEmail(s.familyEmail), status: 'queued' })), calendar: preview.effects.calendar };
    await finishRequest(c, b.requestId, 'done', result);
    return result;
  },

  'mcp/trials/create': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const familyName = String(b.familyName || '').trim().slice(0, 40), givenName = String(b.givenName || '').trim().slice(0, 40);
    if (!familyName) fail('needName', '名字を入れてください');
    if (c.serviceWrite && scopeOf(c) === 'test' && !/^【テスト】/.test(familyName)) fail('outOfScope', 'いまはテスト用（名字が【テスト】）の体験生だけ登録できます（V2_SERVICE_WRITE_SCOPE）', 403);
    const grade = String(b.grade || '').trim().slice(0, 20), note = String(b.note || '').trim().slice(0, 1000);
    // 同じ名前の体験生がもういれば知らせる（二重登録を避ける。登録はしない）
    const same = (await c.db.prepare("select id, familyName, givenName, grade from students where trial = 1 and familyName = ? and givenName = ? and status <> 'left'").bind(familyName, givenName).all()).results;
    const preview = { familyName, givenName, grade, family: familyName + 'さん（メールなし・保護者ページなし・お知らせは届かない）', studentPage: '専用リンクは作らない（生徒ページは管理画面の「専用リンクを作り直す」で使えるようになる）', sameNameTrials: same.map(x => ({ id: x.id, grade: x.grade })) };
    if (b.dryRun === true) return { dryRun: true, ...preview };
    const req = await beginRequest(c, b.requestId, 'trialCreate', { familyName, givenName, grade, note });
    if (req.status === 'done') return { ...parse(req.result), repeated: true };
    if (same.length && b.allowSameName !== true) { await finishRequest(c, b.requestId, 'failed', { error: 'sameName' }); fail('sameName', '同じ名前の体験生がもういます（登録していません）。別の人なら allowSameName を付けて、新しい requestId で', 409, { students: preview.sameNameTrials }); }
    const now = iso(c.now), fid = newId('fa'), sid = newId('su');
    // 専用リンクの鍵は「使えない鍵」（off.）。生徒ページは開けない。管理画面の「専用リンクを作り直す」で使える鍵になる
    const off = 'off.' + sha256Hex(sid + ':' + now + ':' + Math.random()).slice(0, 32);
    const test = c.serviceWrite && scopeOf(c) === 'test' ? 1 : 0;
    await c.db.batch([
      c.db.prepare("insert into families (id, name, guardianName, email, phone, note, status, testOnly, createdAt, updatedAt) values (?, ?, '', '', '', ?, 'invited', ?, ?, ?)").bind(fid, familyName + 'さん', '体験の問い合わせ（MCP で登録）', test, now, now),
      c.db.prepare("insert into students (id, familyId, familyName, givenName, grade, note, status, linkCode, trial, testOnly, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, 'enrolled', ?, 1, ?, ?, ?)").bind(sid, fid, familyName, givenName, grade, note, off, test, now, now),
    ]);
    const result = { requestId: b.requestId, studentId: sid, familyId: fid, student: { id: sid, name: fullName({ familyName, givenName }), grade, trial: true }, studentPage: 'none' };
    await finishRequest(c, b.requestId, 'done', result);
    await audit(c, 'mcpTrialCreate', sid, { familyId: fid });
    return result;
  },

  // カレンダーの作り直し（2026-10-14、Kura 調査 #195）。今日以降の決定の授業と予定の面談のうち、予定がまだ仮の目印（作成を断られたまま）か空のもの。
  // 送っている途中（pending）の頼みがある行は除く。メールは送らない。dryRun で対象だけ返す。範囲（V2_SERVICE_WRITE_SCOPE）がテスト用なら、テスト用の生徒の授業だけ
  'mcp/calendar/repair': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const today = todayJst(c.now);
    const pending = (await c.db.prepare("select payload from effects where status = 'pending' and kind = 'calendarCreate'").all()).results.map(r => parse(r.payload).marker).filter(Boolean);
    const stale = id => (!id || isCalMarker(id)) && !pending.includes(id);
    const lessons = [];
    for (const l of (await c.db.prepare("select * from lessons where status = 'decided' and date >= ? order by date, start").bind(today).all()).results) {
      if (!stale(l.calendarEventId)) continue;
      const s = await studentWithFamily(c, l.studentId);
      if (scopeOf(c) === 'test' && !isTestStudent(s, { testOnly: s.familyTestOnly })) continue;
      lessons.push({ l, s });
    }
    const meetings = scopeOf(c) === 'all' ? (await c.db.prepare("select m.*, f.name familyLabel from meetings m left join families f on f.id = m.familyId where m.status = 'scheduled' and m.date >= ? order by m.date, m.start").bind(today).all()).results.filter(m => stale(m.calendarEventId)) : [];
    const targets = lessons.map(({ l, s }) => ({ kind: 'lesson', id: l.id, student: studentLabel(s), date: l.date, start: l.start, subject: l.subject, was: l.calendarEventId ? 'まだ仮の目印' : '空' }))
      .concat(meetings.map(m => ({ kind: 'meeting', id: m.id, date: m.date, start: m.start, title: m.title, was: m.calendarEventId ? 'まだ仮の目印' : '空' })));
    if (b.dryRun === true) return { dryRun: true, targets, mails: 0 };
    for (const { l, s } of lessons) {
      const marker = await calendarEffect(c, 'create', { ...l, calendarEventId: '' }, fullName(s));
      await c.db.prepare('update lessons set calendarEventId = ? where id = ? and calendarEventId = ?').bind(marker, l.id, l.calendarEventId).run();
    }
    for (const m of meetings) {
      const marker = await calendarEffect(c, 'create', { ...m, subject: m.title, calendarEventId: '' }, String(m.withName || m.familyLabel || '').replace(/さん$/, ''));
      await c.db.prepare('update meetings set calendarEventId = ? where id = ? and calendarEventId = ?').bind(marker, m.id, m.calendarEventId).run();
    }
    await audit(c, 'calendarRepair', '', { lessons: lessons.length, meetings: meetings.length });
    return { targets, queued: targets.length, mails: 0, note: '予定を作る頼みを送りました。届いたかは授業の calendarEventId が「…@google.com」に変わるか、送信の記録で確かめてください' };
  },

  'mcp/requests/get': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const row = await c.db.prepare('select * from mcpRequests where requestId = ?').bind(String(b.requestId || '')).first();
    if (!row) return { found: false, note: 'この requestId の記録はありません（まだ届いていないか、別の ID）。同じ内容なら同じ requestId で再実行して大丈夫です' };
    const result = parse(row.result);
    const out = { found: true, requestId: row.requestId, kind: row.kind, requestStatus: row.status, result, createdAt: row.createdAt, updatedAt: row.updatedAt };
    if (row.kind === 'lessonsSave') {
      const items = (await c.db.prepare('select itemKey, lessonId from mcpRequestItems where requestId = ? order by createdAt').bind(row.requestId).all()).results;
      out.savedItems = items.map(i => ({ key: i.itemKey, lessonId: i.lessonId }));
      out.lessons = await readLessons(c, items.map(i => i.lessonId));
    }
    if (row.kind === 'notice' || row.kind === 'reschedule') out.mailsNow = await mailStatus(c, ((result.mails || []).map(m => m.effectId)));
    return out;
  },
};

// 外の鍵（V2_SERVICE_WRITE_KEY）で通す道。読み戻し・プレビューも含む
export const SERVICE_WRITES = new Set(Object.keys(mcpWriteRoutes));
