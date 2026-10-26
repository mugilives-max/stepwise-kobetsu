// 受講条件書（r6）・特別単価合意書（r9）の表。項目名の列に色を付けた罫線つきの表（2026-10-26 本人「条件のところが organize されていない」「そのほかの約束も罫線で仕切った方が分かりやすい」）
// keyTable: 主な条件。1 行に 2 組（項目名・値）、1 組だけの行は値を右いっぱいに。ruleTable: 約束など、1 行に 1 組
export const keyTable = rows => `<table class="key"><colgroup><col class="kc"><col><col class="kc"><col></colgroup><tbody>${rows.map(r => `<tr>${r.length === 1
  ? `<th scope="row">${r[0][0]}</th><td colspan="3">${r[0][1]}</td>`
  : r.map(([k, v]) => `<th scope="row">${k}</th><td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
export const ruleTable = rows => `<table class="rules"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
export const TABLE_CSS = `
  .key, .rules { width: 100%; border-collapse: collapse; border: 1.5px solid #1e2630; }
  .key { margin-top: 5mm; table-layout: fixed; }
  .key col.kc { width: 42mm; }
  .key th, .key td, .rules th, .rules td { border: 1px solid #aab2bb; padding: 2.8mm 3.5mm; text-align: left; vertical-align: middle; }
  .key th, .rules th { background: #eef1f4; font-size: 12.5px; font-weight: 700; }
  .key td { font-size: 17px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
  .key td small { font-size: 12px; font-weight: 600; }
  .key td .note { display: block; font-size: 12px; font-weight: 500; margin-top: 1mm; }
  .rules th { width: 42mm; vertical-align: top; }
  .rules td { font-size: 13.5px; }
  h2 { border-bottom: 0; padding-bottom: 0; }
  .consent { grid-template-columns: calc(42mm - 4mm) 1fr; } /* 同意の欄の項目名も表の列にそろえる */
  @media print { .key th, .key td, .rules th, .rules td { padding: 2mm 3mm; } .key td { font-size: 15px; } .rules td { font-size: 11.5px; } }`;
