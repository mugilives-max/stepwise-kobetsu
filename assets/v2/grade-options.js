// 学年の選択肢（2026-10-19 本人「学年ってプルダウンではないんですね」）。保護者の申込み・代表の体験生の登録・生徒の情報・成績で同じものを使う。
// 台帳の学年はこの選択肢の値だけ（2026-11-14 本人「以前のデータ形式を廃止して、新方式に統一」）。「中学３年生」のような前の書き方を読み替える normGrade は廃止した
export const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '既卒', 'その他'];
export const GRADE_HINT = '学年は ' + GRADES.join('・') + ' のどれかにしてください';
// 書き込む前の確かめ（空は「まだ決めていない」）。選択肢にない値は受け付けない
export const validGrade = v => v === '' || GRADES.includes(v);
export function gradeOptions(esc, value, placeholder = '選んでください') {
  const v = String(value ?? '');
  return `<option value=""${v ? '' : ' selected'}>${esc(placeholder)}</option>`
    + GRADES.map(g => `<option value="${g}"${g === v ? ' selected' : ''}>${g}</option>`).join('');
}
