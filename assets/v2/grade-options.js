// 学年の選択肢（2026-10-19 本人「学年ってプルダウンではないんですね」）。保護者の申込み・代表の体験生の登録・生徒の情報で同じものを使う。
// 前に手で入れた値（「中３」など全角の数字）は半角にそろえて扱う。選択肢にない前の値は、消さずに選択肢の頭に残す。
export const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '既卒', 'その他'];
export const normGrade = v => String(v ?? '').trim().replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
export function gradeOptions(esc, value, placeholder = '選んでください') {
  const v = normGrade(value);
  return `<option value=""${v ? '' : ' selected'}>${esc(placeholder)}</option>`
    + (v && !GRADES.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '')
    + GRADES.map(g => `<option value="${g}"${g === v ? ' selected' : ''}>${g}</option>`).join('');
}
