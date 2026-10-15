"""Build the adopted terms on GitHub Actions, with text and visual QA outputs."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from bs4 import BeautifulSoup
from markdown_it import MarkdownIt
from playwright.sync_api import sync_playwright
import fitz

ROOT = Path(__file__).resolve().parents[1]
EDITION = "2026-11-20261015-r8"
SOURCE = ROOT / "docs/terms-restructure-2026-11/TERMS.md"
OUT = ROOT / "terms" / EDITION
REVIEW = ROOT / "docs/terms-restructure-2026-11/publication-preview-20261015-r8"
REPORT = ROOT / "docs/terms-restructure-2026-11/PUBLICATION_CHECKS_20261015_R8.json"
PDF_NAME = "stepwise-terms-" + EDITION + ".pdf"
EXPECTED_SOURCE_BLOB = "4f8f77fb3be149877b53b162cb44814337ce7d57"
OLD = {
    "terms/2026-11-20261012-r2/index.html": "354a8bf240736f03fc9d401e8e693f5dae2c435b",
    "terms/2026-11-20261012-r2/stepwise-terms-2026-11-20261012-r2.pdf": "6bdba5b303751f968ef031d0ee0db00e86981a8c",
    "terms/2026-11-20261012-r3/index.html": "85e0c094cc0653e5b4983ed6c8793424c9b89556",
    "terms/2026-11-20261012-r3/stepwise-terms-2026-11-20261012-r3.pdf": "e8c2f643a818e79e9e619a279a416de0e1f8d708",
    "terms/2026-11-20261012-r3/waiver/index.html": "5ffc89314099bbc37d218b4563e60987294ea63f",
    "terms/2026-11-20261012-r3/waiver/stepwise-waiver-guide-20261012.pdf": "a337e856f11b6301d4be8e1a237092ec804aba8c",
    "terms/2026-11-20261012/index.html": "8ad7081a13be099e8b3f8e76c04d986886bb971c",
    "terms/2026-11-20261012/stepwise-terms-2026-11-20261012.pdf": "a391290531d024ff6d3bb1298fe2394b59345b92",
    "terms/2026-11-20261014-r4/index.html": "f72916fd77944ad3b9ff5aba58847c824bed430a",
    "terms/2026-11-20261014-r4/stepwise-terms-2026-11-20261014-r4.pdf": "603aa2417b772ae43911408c5743c3bf9efb051f",
    "terms/2026-11-20261014-r5/documents/agreement/agreement.pdf": "54d9d00bec1eb7b6e9077feb2be4ee709d623aaf",
    "terms/2026-11-20261014-r5/documents/agreement/index.html": "06835fbc839421ddcc3accfe2e057c412ebe4b87",
    "terms/2026-11-20261014-r5/documents/regular/index.html": "8ac2477aff99ce9ff7b666761a4f38f6e186eeb3",
    "terms/2026-11-20261014-r5/documents/regular/regular.pdf": "cc87798034fe25b6191213a0b335176e3dbdb1bb",
    "terms/2026-11-20261014-r5/documents/special/index.html": "98fdad42f68c183f88c61a6c412b2fb107f3b973",
    "terms/2026-11-20261014-r5/documents/special/special.pdf": "7ecf138d100ac4bf5c203cd7bbc134c54853f8f7",
    "terms/2026-11-20261014-r5/index.html": "88c2dc9fbeca0c373fc2bdc503d99f369fe49840",
    "terms/2026-11-20261014-r5/stepwise-terms-2026-11-20261014-r5.pdf": "5e675693620db1899bf55d899956d35808e5a28b",
    "terms/2026-11-20261014-r6/documents/agreement/agreement.pdf": "d12740bb845b6cd14822f8cd06c0d6dae7d03448",
    "terms/2026-11-20261014-r6/documents/agreement/index.html": "af220eb557d78867de84fd82c34903131abc6492",
    "terms/2026-11-20261014-r6/documents/regular/index.html": "b174312d088a3f031773efcc1e9c2aa02ba19829",
    "terms/2026-11-20261014-r6/documents/regular/regular.pdf": "e08c79187531ba3e7f4d37afca933d68fc395b39",
    "terms/2026-11-20261014-r6/documents/special/index.html": "b77b0effdb8526ba58741ac78fe884177ab88f7e",
    "terms/2026-11-20261014-r6/documents/special/special.pdf": "ca343fbe764f5a9cff280acbcb6bcfd7207a3257",
    "terms/2026-11-20261014-r6/index.html": "d5a835de01b0724a219cc23f7eed5dd0d0777e46",
    "terms/2026-11-20261014-r6/stepwise-terms-2026-11-20261014-r6.pdf": "d203cd50d2194b7d43834b287c27cd35138876f5",
    "terms/2026-11-20261014-r6/waiver/index.html": "fe903a8e627fab3b509c2dd2422131a052961ee8",
    "terms/2026-11-20261014-r6/waiver/waiver.pdf": "2098c1c5fc0e32dd064758c7f347192c9834c4ec",
    "terms/2026-11-20261014-r7/index.html": "e8b1f1ee6f1a2571cbce9e7e2a96369e18e34bc7",
    "terms/2026-11-20261014-r7/stepwise-terms-2026-11-20261014-r7.pdf": "814d0f528d84bed989720dbed0e0c3c781893a34",
    "terms/2026-11/index.html": "84325add6c395ff9cbe8588abcc3c0221e40b03f",
    "terms/2026-11/stepwise-terms-2026-11.pdf": "94bcb70dc1eb25afdd78393c306d0d5ec518e6e9"
}

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def compact(text):
    return re.sub(r"\s+", "", text).replace("\u2022", "")

source_bytes = SOURCE.read_bytes()
assert git_blob(source_bytes) == EXPECTED_SOURCE_BLOB, "The adopted source has changed; review the edition before rebuilding."
for name, expected in OLD.items():
    assert git_blob((ROOT / name).read_bytes()) == expected, "Old edition changed: " + name
source = source_bytes.decode("utf-8")
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
# Regenerate only this new edition; old editions remain untouched.
for prior_png in REVIEW.glob("*.png"):
    prior_png.unlink()

md = MarkdownIt("commonmark", {"html": True}).enable("table")
body = BeautifulSoup(md.render(source), "html.parser")

# Put each explicit anchor on its heading/list instead of leaving an empty line.
for anchor in list(body.select("a[id]")):
    parent = anchor.parent
    holder = parent if parent.name == "p" and not parent.get_text(strip=True) else anchor
    target = holder.find_next_sibling()
    if target is not None and target.name in ("h1", "h2", "h3", "ol", "ul", "p", "hr"):
        target["id"] = anchor["id"]
        holder.decompose()
for listing in body.find_all("ol", id=re.compile(r"^article-\d+-item-\d+$")):
    listing["class"] = ["clause"]
    expected_number = int(listing["id"].rsplit("-", 1)[1])
    assert int(listing.get("start", 1)) == expected_number, listing["id"]
for heading in body.find_all("h2", id=re.compile(r"^chapter-")):
    heading["class"] = ["chapter"]
for table in body.find_all("table"):
    table["class"] = ["fees"]
for heading in body.find_all(["h1", "h2", "h3"]):
    heading["tabindex"] = "-1"

ids = [tag["id"] for tag in body.select("[id]")]
assert len(ids) == len(set(ids)), "Duplicate anchors"
assert len([v for v in ids if re.fullmatch(r"article-\d+", v)]) == 33
assert len([v for v in ids if re.fullmatch(r"article-\d+-item-\d+", v)]) == 151
assert len([v for v in ids if re.fullmatch(r"chapter-\d+", v)]) == 8
assert len(body.find_all("table")) == 5
for link in body.select('a[href^="#"]'):
    assert link["href"][1:] in ids, "Broken internal link: " + link["href"]

# Independent source-to-HTML comparison, excluding only Markdown formatting.
def source_text(value):
    value = re.sub(r'<a id="[^"]+"></a>', "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"(?m)^\s*\|(?:\s*:?-+:?\s*\|)+\s*$", "", value)
    value = re.sub(r"(?m)^---\s*$", "", value)
    value = re.sub(r"(?m)^\s*(?:#{1,6}|\d+\.|-)\s+", "", value)
    return compact(value.replace("**", "").replace("|", ""))

expected_plain = source_text(source)
html_plain = compact(body.get_text("", strip=False))
assert expected_plain == html_plain, "Markdown-to-HTML text changed"

css = """
:root { color-scheme: light; --ink:#172526; --teal:#176c69; --line:#b9cdcb; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:1.5rem; }
body { margin:0; background:#f5f8f7; color:var(--ink); font-family:"Noto Sans CJK JP","Yu Gothic","Hiragino Sans",Meiryo,sans-serif; font-size:16px; line-height:1.85; }
a { color:#126964; text-underline-offset:.18em; }
a:hover { color:#073e3a; }
a:focus-visible { outline:3px solid #e6a94a; outline-offset:3px; }
.tools { max-width:900px; margin:0 auto; padding:20px 28px 8px; font-size:14px; display:flex; flex-wrap:wrap; gap:8px 22px; }
main { max-width:900px; margin:0 auto 36px; padding:30px 42px 40px; background:#fff; border:1px solid #dce7e5; border-radius:4px; }
h1 { font-size:1.62rem; line-height:1.5; margin:0 0 12px; letter-spacing:.025em; }
h2 { font-size:1.28rem; line-height:1.6; margin:32px 0 14px; padding-bottom:7px; border-bottom:1px solid var(--line); break-after:avoid; }
h2.chapter { border-bottom:2px solid var(--teal); color:var(--teal); }
h3 { font-size:1.08rem; line-height:1.6; margin:25px 0 9px; break-after:avoid; }
p { margin:9px 0; }
ol,ul { padding-left:1.65em; margin:8px 0; }
li { padding-left:.16em; }
.clause { margin:8px 0; }
.clause > li > p:first-child { margin-top:0; }
.clause > li > p:last-child { margin-bottom:0; }
table { width:100%; border-collapse:collapse; margin:16px 0; font-size:.88em; line-height:1.65; break-inside:avoid; }
th,td { text-align:left; vertical-align:top; border:1px solid var(--line); padding:7px 9px; overflow-wrap:anywhere; }
th { background:#edf5f3; font-weight:600; }
td:not(:first-child),th:not(:first-child) { min-width:3.4em; }
hr { border:0; border-top:1px solid var(--line); margin-top:28px; }
#footer + p { font-size:.86em; color:#405452; overflow-wrap:anywhere; }
@media(max-width:600px) {
 body { font-size:15px; line-height:1.85; }
 .tools { padding:16px 18px 8px; }
 main { padding:23px 18px 28px; border-left:0; border-right:0; border-radius:0; }
 h1 { font-size:1.36rem; } h2 { font-size:1.18rem; } h3 { font-size:1.04rem; }
 table { font-size:.78em; } th,td { padding:6px 4px; }
 ol,ul { padding-left:1.45em; }
}
@page { size:A4; margin:17mm 16mm 18mm; }
@media print {
 html { scroll-behavior:auto; }
 body { background:#fff; font-size:9.6pt; line-height:1.65; color:#111; }
 .tools { display:none; }
 main { max-width:none; padding:0; margin:0; border:0; border-radius:0; }
 h1 { font-size:16pt; margin:0 0 7pt; }
 h2 { font-size:12pt; margin:16pt 0 7pt; padding-bottom:4pt; }
 h3 { font-size:10.5pt; margin:12pt 0 5pt; }
 p { margin:5pt 0; orphans:3; widows:3; }
 ol,ul { margin:5pt 0; }
 .clause { margin:5pt 0; break-inside:avoid; }
 table { font-size:8.7pt; line-height:1.6; margin:9pt 0; }
 th,td { padding:5pt 6pt; }
 a { color:inherit; text-decoration:none; }
 #footer + p { font-size:8pt; }
 .chapter + p, .clause:has(+ table) { break-after:avoid; }
 #article-2 { break-before:page; }
 #appendix-online { break-before:auto; }
}
"""
# Every old paragraph has an explicit destination; table/list rewrites are recorded.
PRIOR_COMMIT = "3c02676f751b64c3018e7b9efce63ab9982566cc"
prior_source = subprocess.check_output(["git","show",PRIOR_COMMIT+":docs/terms-restructure-2026-11/TERMS.md"],text=True)
manifest = json.loads((SOURCE.parent / "FLOW_MOVE_CHECKS_20261015_R8.json").read_text(encoding="utf-8"))
def clauses(value):
    return {m[1]:m[2].strip() for m in re.finditer(r'<a id="(article-\d+-item-\d+)"></a>\n\n\d+\. ([\s\S]*?)(?=\n\n<a id=|$)',value)}
def normalized(value):
    value = re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",value)
    value = re.sub(r'<a[^>]*></a>',"",value)
    value = re.sub(r"第[0-9０-９～・]+(?:条|項)","REF",value).replace("同条","REF")
    return re.sub(r"\s+","",value).replace("**","").replace("|","")
old_clauses,new_clauses = clauses(prior_source),clauses(source)
assert len(old_clauses)==138 and len(new_clauses)==151
assert new_clauses == manifest["new_clauses"], "Reviewed text changed"
assert set(old_clauses)=={k for k in manifest["old_units"] if k.startswith("article-")}
assert len(manifest["old_units"])==140
matched=0
manual=[]
for key, entry in manifest["old_units"].items():
    if key in old_clauses: assert entry["old"]==old_clauses[key],key
    else: assert entry["old"] in prior_source,key
    destinations=normalized("\n".join(new_clauses[k] for k in entry["targets"]))
    fragments=[v.strip() for v in re.findall(r"[^。]+。|[^。]+$",entry["old"]) if v.strip()]
    for number, fragment in enumerate(fragments):
        if normalized(fragment) in destinations:
            matched+=1
        else:
            found=[x for x in manifest["manual_equivalence"] if x["id"]==key and x["index"]==number and x["text"]==fragment]
            assert len(found)==1 and found[0]["reason"],(key,number,fragment)
            manual.append(found[0])
assert matched==283 and len(manual)==28
for pair in manifest["protected"]:
    assert old_clauses[pair["old"]]==new_clauses[pair["new"]],pair
assert normalized(old_clauses["article-15-item-1"])==normalized(new_clauses["article-15-item-1"])
assert normalized(old_clauses["article-19-item-3"])==normalized(new_clauses["article-17-item-4"])
old_tables=re.findall(r"(?m)^\|.*(?:\n\|.*)*",prior_source)
new_tables=re.findall(r"(?m)^\|.*(?:\n\|.*)*",source)
assert len(old_tables)==3 and len(new_tables)==5
assert all(normalized(t) in [normalized(v) for v in new_tables] for t in old_tables), "Fee tables changed"
old_example=prior_source.split('<a id="appendix-online"></a>')[1].split('<a id="appendix-waiver"></a>')[0]
for sentence in re.findall(r"[^。]+。",old_example.split("\n\n",2)[2]):
    assert normalized(sentence.strip()) in normalized(source), "Online example changed"
assert len(ids)==196
for link in body.select('a[href^="#article-"]'):
    label=re.fullmatch(r"第(\d+)条(?:第(\d+)項)?",link.get_text())
    if label:
        target="article-"+label[1]+("-item-"+label[2] if label[2] else "")
        assert link["href"]=="#"+target,"Reference label differs from anchor"
waiver_url="https://www.stepwise-education.jp/terms/2026-11-20261015-r8/waiver/"
assert [a["href"] for a in body.select("a[href]") if "/waiver/" in a["href"]] == [waiver_url]
# Related documents only change article references and the edition/date/link.
related_replacements={
 "TEACHING_CONDITIONS_REGULAR.md":[("第2条・第5条～第8条・第17条・第27条","第2・3条・第5条～第8条・第16条")],
 "TEACHING_CONDITIONS_SPECIAL.md":[("第5条～第7条・第11条・第32条","第5条～第7条・第10・12・26条")],
 "TUITION_AGREEMENT.md":[("第3条・第7条・第9条～第16条","第7条・第9条～第17条")],
 "WAIVER_GUIDE.md":[("第17・21・25・26・30条","第16・22・24・25・31条"),("20261014-r6","20261015-r8"),("2026年10月14日","2026年10月15日"),("（r6）","（r8）")]
}
for filename, replacements in related_replacements.items():
    before=subprocess.check_output(["git","show",PRIOR_COMMIT+":"+str(SOURCE.parent.relative_to(ROOT)/filename)],text=True)
    for old,new in replacements:
        assert old in before
        before=before.replace(old,new)
    assert before==(SOURCE.parent/filename).read_text(encoding="utf-8"),filename

html = '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>受講規約（2026年11月版・10月15日改訂）｜ステップワイズ個別指導</title><style>' + css + '</style></head><body>\n<nav class="tools" aria-label="規約の関連ページ"><a href="' + PDF_NAME + '">PDFで開く</a><a href="waiver/">免除申請のご案内</a><a href="../">規約の版一覧・旧版</a><a href="/">ステップワイズ個別指導</a></nav>\n<main id="contract">' + str(body) + '</main>\n</body></html>\n'
(OUT / "index.html").write_text(html, encoding="utf-8")

index_html = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>受講規約の版一覧｜ステップワイズ個別指導</title>
<style>body{font-family:"Yu Gothic","Noto Sans CJK JP",Meiryo,sans-serif;color:#172526;line-height:1.9;margin:36px auto;padding:0 22px;max-width:760px}h1{font-size:1.6rem}h2{font-size:1.2rem;border-bottom:1px solid #b9cdcb;padding-bottom:7px;margin-top:28px}a{color:#126964}li{margin:9px 0}.note{color:#405452}</style></head><body>
<p><a href="/">ステップワイズ個別指導</a></p><h1>受講規約の版一覧</h1>
<p>受講規約の本文とPDFをご確認いただけます。適用されるのは、ご家庭が同意した版です。掲載の更新だけで過去に同意した内容を置き換えることはありません。</p>
<h2>正式版：2026年11月版（2026年10月15日改訂・全体の構成整理）</h2>
<p>適用開始日：2026年11月1日。全8章・33条。受講条件、月ごとの合意、日時の予約、費用、精算の順に整理した版です。料金・期限・承認・予約の条件は変えていません。</p>
<ul><li><a href="2026-11-20261015-r8/">Web版を読む</a></li><li><a href="2026-11-20261015-r8/stepwise-terms-2026-11-20261015-r8.pdf">PDFで開く</a></li></ul>
<h2>旧版：2026年11月版（2026年10月14日改訂・r7）</h2>
<p>受講合意書の役割を冒頭で説明した版です。</p>
<ul><li><a href="2026-11-20261014-r7/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261014-r7/stepwise-terms-2026-11-20261014-r7.pdf">旧版のPDFで開く</a></li></ul>
<h2>旧版：2026年11月版（2026年10月14日改訂・r6）</h2>
<p>適用開始日：2026年11月1日。全8章・36条。受講内容の合意と、授業日時の調整・予約を分けた版です。塾内部の「下書き」の説明を外し、料金や予約の条件は変えていません。</p>
<ul><li><a href="2026-11-20261014-r6/">Web版を読む</a></li><li><a href="2026-11-20261014-r6/stepwise-terms-2026-11-20261014-r6.pdf">PDFで開く</a></li></ul>
<h2>関連書類の空欄様式</h2>
<ul><li><a href="2026-11-20261015-r8/documents/regular/">受講条件書（通常指導）</a>（<a href="2026-11-20261015-r8/documents/regular/regular.pdf">PDF</a>）</li><li><a href="2026-11-20261015-r8/documents/special/">受講条件書（特殊指導）</a>（<a href="2026-11-20261015-r8/documents/special/special.pdf">PDF</a>）</li><li><a href="2026-11-20261015-r8/documents/agreement/">受講合意書</a>（<a href="2026-11-20261015-r8/documents/agreement/agreement.pdf">PDF</a>）</li></ul>
<h2>旧版：2026年11月版（2026年10月14日改訂・r5）</h2>
<p>契約書類の名称を受講条件書・受講合意書に統一した版です。</p>
<ul><li><a href="2026-11-20261014-r5/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261014-r5/stepwise-terms-2026-11-20261014-r5.pdf">旧版のPDFで開く</a></li></ul>
<p>当時の空欄様式：<a href="2026-11-20261014-r5/documents/regular/">通常指導</a>・<a href="2026-11-20261014-r5/documents/special/">特殊指導</a>・<a href="2026-11-20261014-r5/documents/agreement/">受講合意書</a>（各ページにPDF）。</p>
<h2>旧版：2026年11月版（2026年10月14日改訂・r4）</h2>
<p>授業予定の段階と予約を整理した版です。</p>
<ul><li><a href="2026-11-20261014-r4/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261014-r4/stepwise-terms-2026-11-20261014-r4.pdf">旧版のPDFで開く</a></li></ul>
<h2>キャンセル料金の免除申請</h2>
<ul><li><a href="2026-11-20261015-r8/waiver/">免除申請のご案内を読む</a></li><li><a href="2026-11-20261015-r8/waiver/waiver.pdf">案内をPDFで開く</a></li></ul>
<p><a href="2026-11-20261014-r6/waiver/">旧案内（r6・r7）</a>、<a href="2026-11-20261012-r3/waiver/">旧案内（r3～r5の条番号）</a>も保存しています。</p>
<h2>旧版：2026年11月版（2026年10月12日改訂・r3）</h2>
<p>特殊指導の途中終了と返金の扱いを明確にし、免除申請の共通案内を用意した版です。</p>
<ul><li><a href="2026-11-20261012-r3/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261012-r3/stepwise-terms-2026-11-20261012-r3.pdf">旧版のPDFで開く</a></li></ul>
<h2>旧版：2026年11月版（2026年10月12日改訂・r2）</h2>
<p>単価・指導区分、承認手続、精算・返金、資料の取り扱い等を整理した版です。</p>
<ul><li><a href="2026-11-20261012-r2/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261012-r2/stepwise-terms-2026-11-20261012-r2.pdf">旧版のPDFで開く</a></li></ul>
<h2>旧版：2026年11月版（2026年10月12日初回公開）</h2>
<p>適用開始日：2026年11月1日。全7章・32条。</p>
<ul><li><a href="2026-11-20261012/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261012/stepwise-terms-2026-11-20261012.pdf">旧版のPDFで開く</a></li></ul>
<h2>旧版：2026年11月版（25条版）</h2>
<p>2026年11月版（20261006統合3を確定したもの）。全25条。旧版の本文とファイルを保存しています。</p>
<ul><li><a href="2026-11/">旧版のWeb版を読む</a></li><li><a href="2026-11/stepwise-terms-2026-11.pdf">旧版のPDFで開く</a></li></ul>
<p class="note">ご自身に適用される版が分からない場合は、当塾との通常連絡に使用しているLINE、または <a href="mailto:mugilives@gmail.com">mugilives@gmail.com</a> へお問い合わせください。</p>
</body></html>
"""
(ROOT / "terms/index.html").write_text(index_html, encoding="utf-8")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    page.goto((OUT / "index.html").as_uri())
    page.evaluate("document.fonts.ready")
    assert page.locator("#contract").inner_text().strip()
    page.pdf(
        path=str(OUT / PDF_NAME), format="A4", print_background=True,
        prefer_css_page_size=True, display_header_footer=True,
        header_template='<span></span>',
        footer_template='<div style="width:100%;font-size:8px;color:#536563;text-align:center;font-family:sans-serif;">Stepwise / 2026-11-20261015-r8 &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        tagged=True, outline=True,
    )
    page.emulate_media(media="screen")
    page.set_viewport_size({"width":390,"height":844})
    page.screenshot(path=str(REVIEW / "mobile.png"))
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile overflow"
    page.locator("#article-2-item-2").scroll_into_view_if_needed()
    page.screenshot(path=str(REVIEW / "mobile-documents.png"))
    page.locator("#article-18-item-4").scroll_into_view_if_needed()
    page.screenshot(path=str(REVIEW / "mobile-fees.png"))
    for table in page.locator("table").all():
        assert table.bounding_box()["width"] <= 354, "Mobile table overflow"
    page.locator("#article-13-item-2").scroll_into_view_if_needed()
    page.screenshot(path=str(REVIEW / "mobile-stages.png"))
    page.locator("#article-14-item-3").scroll_into_view_if_needed()
    page.screenshot(path=str(REVIEW / "mobile-confirmation.png"))
    page.set_viewport_size({"width":320,"height":844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Narrow mobile overflow"
    browser.close()

pdf = fitz.open(OUT / PDF_NAME)
assert 4 <= len(pdf) <= 20, "Unexpected page count"
page_texts = []
font_names = set()
for number, page in enumerate(pdf, 1):
    page.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(REVIEW / f"page-{number:02}.png")
    blocks = page.get_text("blocks")
    content = [block[4] for block in blocks if block[1] > 30 and block[3] < page.rect.height - 32]
    page_texts.append("\n".join(content))
    for font in page.get_fonts():
        font_names.add(font[3])
    assert content, "Blank page"
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                box = span["bbox"]
                assert box[0] >= 25 and box[2] <= page.rect.width - 25, "Text exceeds side margins"

pdf_plain = compact("\n".join(page_texts))
assert "\ufffd" not in pdf_plain, "PDF replacement glyph"
checks = []
for tag in body.find_all(["p", "h1", "h2", "h3", "td", "th", "li"]):
    if tag.name == "li" and tag.find(["p", "ul", "ol"], recursive=False):
        continue
    text = compact(tag.get_text("", strip=False))
    if text:
        checks.append(text)
missing = [v for v in checks if v not in pdf_plain]
if missing:
    (REVIEW / "missing-text.json").write_text(json.dumps(missing,ensure_ascii=False,indent=2),encoding="utf-8")
assert not missing, f"PDF text missing in {len(missing)} blocks: {missing[:2]}"
font_report = subprocess.check_output(["pdffonts", str(OUT / PDF_NAME)], text=True)
font_rows = font_report.strip().splitlines()[2:]
assert font_rows, "PDF has no fonts"
assert all(re.search(r"\s+yes\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$", row) for row in font_rows), "PDF contains a nonembedded font: " + font_report
font_match = subprocess.check_output(["fc-match", "Noto Sans CJK JP", "-f", "%{family}"], text=True)
assert "Noto Sans CJK JP" in font_match, "Japanese font unavailable"

report = {
    "edition":EDITION, "effective_date":"2026-11-01",
    "source_path":str(SOURCE.relative_to(ROOT)),
    "source_git_blob":EXPECTED_SOURCE_BLOB,
    "source_commit":subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip(),
    "html_sha256":hashlib.sha256((OUT / "index.html").read_bytes()).hexdigest(),
    "pdf_sha256":hashlib.sha256((OUT / PDF_NAME).read_bytes()).hexdigest(),
    "old_blobs_preserved":OLD,
    "chapters":8,"articles":33,"numbered_paragraphs":151,"tables":5,
    "markdown_to_html_full_text_equal":True,
    "internal_links_valid":True,"mobile_overflow":False,
    "pdf_pages":len(pdf),"pdf_text_blocks_verified":len(checks),
    "pdf_missing_text_blocks":0,
    "pdf_fonts":sorted({row.split()[0].split("+",1)[-1] for row in font_rows}),
    "pdf_fonts_embedded":True,"embedded_font_programs":len(font_rows),"japanese_font_match":font_match,
    "visual_review_images":len(pdf)+4,
    "anchors": len(ids), "mobile_widths_checked": [390, 320],
}
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

report["prior_source_commit"] = PRIOR_COMMIT
report["mapped_old_units"] = 140
report["verbatim_sentence_fragments"] = matched
report["reviewed_equivalent_fragments"] = len(manual)
report["deferred_conditions_unchanged"] = True
report["fee_tables_and_examples_unchanged"] = True
report["related_documents_reference_only_change"] = True
# The three blank forms and waiver guide use the same source-to-HTML/PDF checks.
forms = [
    ("regular","TEACHING_CONDITIONS_REGULAR.md"),
    ("special","TEACHING_CONDITIONS_SPECIAL.md"),
    ("agreement","TUITION_AGREEMENT.md"),
    ("waiver","WAIVER_GUIDE.md"),
]
report["forms"] = []
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={"width":1000,"height":1400})
    for slug, filename in forms:
        form_source=(SOURCE.parent / filename).read_text(encoding="utf-8")
        form_body=BeautifulSoup(md.render(form_source),"html.parser")
        assert source_text(form_source)==compact(form_body.get_text("",strip=False))
        title=form_body.h1.get_text()
        dest=OUT/slug if slug=="waiver" else OUT/"documents"/slug
        dest.mkdir(parents=True,exist_ok=True)
        form_css=css+"\ntable:has(th:nth-child(2):last-child) th:first-child{width:38%} @media print { body{font-size:8.8pt;line-height:1.5} h1{font-size:15pt} h2{margin:8pt 0 5pt;font-size:11pt} p{margin:4pt 0} table{font-size:8.3pt;line-height:1.5;margin:6pt 0} th,td{padding:4pt 5pt} }"
        if slug=="waiver": form_css=css
        form_html='<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>'+title+'｜ステップワイズ個別指導</title><style>'+form_css+'</style></head><body><nav class="tools"><a href="'+slug+'.pdf">PDFで開く</a><a href="../../">受講規約</a><a href="../../../">書類・旧版一覧</a></nav><main>'+str(form_body)+'</main></body></html>'
        if slug=="waiver":
            form_html=form_html.replace('href="../../">受講規約','href="../">受講規約').replace('href="../../../">書類・旧版一覧','href="../../">書類・旧版一覧')
        (dest/"index.html").write_text(form_html,encoding="utf-8")
        page.goto((dest/"index.html").as_uri());page.evaluate("document.fonts.ready")
        page.pdf(path=str(dest/(slug+".pdf")),format="A4",prefer_css_page_size=True,print_background=True,display_header_footer=True,header_template="<span></span>",footer_template='<div style="width:100%;font:8px sans-serif;text-align:center">Stepwise / 20261015-r8 / '+slug+'　<span class="pageNumber"></span> / <span class="totalPages"></span></div>',tagged=True)
        page.set_viewport_size({"width":320,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),slug
        page.screenshot(path=str(REVIEW/(slug+"-mobile.png")))
        doc=fitz.open(dest/(slug+".pdf"))
        plain=compact("\n".join(block[4] for pg in doc for block in pg.get_text("blocks") if block[1]>30 and block[3]<pg.rect.height-32))
        for tag in form_body.find_all(["p","h1","h2","th","td"]):
            text=compact(tag.get_text())
            assert not text or text in plain, (slug,text)
        for i,pg in enumerate(doc,1):
            pg.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(REVIEW/f"{slug}-page-{i:02}.png")
            for block in pg.get_text("blocks"):
                assert block[0]>=25 and block[2]<=pg.rect.width-25,(slug,"side margin")
        fonts=subprocess.check_output(["pdffonts",str(dest/(slug+".pdf"))],text=True).strip().splitlines()[2:]
        assert fonts and all(re.search(r"\s+yes\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$",row) for row in fonts)
        report["forms"].append({"name":title,"source":filename,"pages":len(doc),"text_verified":True,"fonts_embedded":True,"pdf_sha256":hashlib.sha256((dest/(slug+".pdf")).read_bytes()).hexdigest()})
    browser.close()
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
pdf_waiver_links=[link["uri"] for pg in pdf for link in pg.get_links() if "/waiver/" in link.get("uri","")]
assert len(pdf_waiver_links)>=1 and set(pdf_waiver_links)=={waiver_url}
report["waiver_links_verified"]=True
report["visual_review_images"]=len(list(REVIEW.glob("*.png")))
report["total_pdf_pages"]=len(pdf)+sum(form["pages"] for form in report["forms"])
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(report,ensure_ascii=False,indent=2))
