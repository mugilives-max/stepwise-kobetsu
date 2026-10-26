// 科目は選んで入れる。選択肢にないものだけ「その他」に書く（2026-10-26 本人「科目も選択できるようにしてくれる？自由入力はその他の科目で十分」）。
// 保存は今までどおり「英語・数学」の 1 つの文字列。
export const SUBJECTS = ['英語', '数学', '国語', '理科', '社会', '物理', '化学', '生物', '日本史', '世界史', '地理'];
const split = v => String(v || '').split(/[・、,，\s]+/).map(x => x.trim()).filter(Boolean);
export function subjectFields(esc, value, name = 'subjects') {
  const have = split(value), other = have.filter(x => !SUBJECTS.includes(x)).join('・');
  return `<div class="choices" style="grid-template-columns:repeat(auto-fill,minmax(96px,1fr))">${SUBJECTS.map(s => `<label class="choice"><input type="checkbox" name="${name}" value="${esc(s)}"${have.includes(s) ? ' checked' : ''}><span>${esc(s)}</span></label>`).join('')}</div>
    <label>その他の科目<input name="${name}Other" value="${esc(other)}" maxlength="60"></label>`;
}
// フォームから「英語・数学・〇〇」を作る
export function readSubjects(form, name = 'subjects') {
  const fd = new FormData(form);
  return [...fd.getAll(name).map(String), ...split(fd.get(name + 'Other'))].filter((x, i, a) => a.indexOf(x) === i).join('・').slice(0, 100);
}
