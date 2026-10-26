// 個別受講条件書（r6）・特別単価合意書（r9）の表。項目名の列に色を付けた罫線つきの表（2026-10-26 本人「条件のところが organize されていない」「そのほかの約束も罫線で仕切った方が分かりやすい」）
// keyTable: 主な条件。左に大きなまとまり（生徒・授業など）、その右に項目と値（同日 本人「左に大きな項目で、生徒情報として、氏名、学年と分けても良い」「項目と記載している文字の大きさがあっていない」）
//   groups = [[まとまりの名前, [[項目, 値], …]], …]。ruleTable: 約束など、1 行に 1 組
export const keyTable = groups => `<table class="key"><colgroup><col class="gc"><col class="kc"><col></colgroup><tbody>${groups.map(([g, rows]) => rows.map(([k, v], i) =>
  `<tr>${i ? '' : `<th scope="rowgroup" class="grp" rowspan="${rows.length}">${g}</th>`}<th scope="row">${k}</th><td>${v}</td></tr>`).join('')).join('')}</tbody></table>`;
export const ruleTable = rows => `<table class="rules"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
export const TABLE_CSS = `
  .key, .rules { width: 100%; border-collapse: collapse; border: 1.5px solid #1e2630; }
  .key { margin-top: 5mm; table-layout: fixed; }
  h2 + .key { margin-top: 0; }
  .key col.gc { width: 16mm; }
  .key col.kc { width: 44mm; }
  .key th, .key td, .rules th, .rules td { border: 1px solid #aab2bb; padding: 2.4mm 3.5mm; text-align: left; vertical-align: middle; font-size: 14.5px; line-height: 1.5; }
  .key th, .rules th { background: #eef1f4; font-weight: 700; text-align: center; vertical-align: middle; } /* 項目名はマスの中央（同日 本人「項目がマスに対して不自然…中央揃えにした方が良い」） */
  .key th.grp { background: #dfe5eb; }
  .key td { font-weight: 700; overflow-wrap: anywhere; }
  .key td small { font-size: 12px; font-weight: 600; }
  .key td .note { display: block; font-size: 12px; font-weight: 500; margin-top: .5mm; }
  .rules th { width: 40mm; }
  .rules th, .rules td { font-size: 14px; }
  h2 { border-bottom: 0; padding-bottom: 0; }
  .consent { grid-template-columns: calc(40mm - 4mm) 1fr; } /* 同意の欄の項目名も表の列にそろえる */
  @media print { .key th, .key td, .rules th, .rules td { padding: 1.8mm 3mm; font-size: 12.5px; } .rules td { font-size: 11.5px; } }`;
