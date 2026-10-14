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
EDITION = "2026-11-20261014-r6"
SOURCE = ROOT / "docs/terms-restructure-2026-11/TERMS.md"
OUT = ROOT / "terms" / EDITION
REVIEW = ROOT / "docs/terms-restructure-2026-11/publication-preview-20261014-r6"
REPORT = ROOT / "docs/terms-restructure-2026-11/PUBLICATION_CHECKS_20261014_R6.json"
PDF_NAME = "stepwise-terms-" + EDITION + ".pdf"
EXPECTED_SOURCE_BLOB = "0ab35ef5c002627ffefcf5ae7065b3894c661194"
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
# Clear only this unpublished edition\'s generated page previews before rerendering.
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
assert len([v for v in ids if re.fullmatch(r"article-\d+", v)]) == 36
assert len([v for v in ids if re.fullmatch(r"article-\d+-item-\d+", v)]) == 138
assert len([v for v in ids if re.fullmatch(r"chapter-\d+", v)]) == 8
assert len(body.find_all("table")) == 3
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
 .chapter + p, #article-18-item-3 { break-after:avoid; }
 #appendix-online { break-before:auto; }
}
"""
# Check every retained clause and every moved source fragment against the fixed r5 source.
PRIOR_COMMIT = "bd60046fc8a8ffab54b5ef2c02992659e67d8847"
prior_source = subprocess.check_output(["git","show",PRIOR_COMMIT+":docs/terms-restructure-2026-11/TERMS.md"],text=True)
def renumber(value):
    value = re.sub(r"第(\d+(?:[～〜・]\d+)*)条",
        lambda m:"第"+re.sub(r"\d+",lambda n:str(int(n[0])+4 if int(n[0])>=13 else int(n[0])),m[1])+"条",value)
    return re.sub(r"article-(\d+)",lambda m:"article-"+str(int(m[1])+4 if int(m[1])>=13 else int(m[1])),value)
def clauses(value):
    return {m[1]:m[2].strip() for m in re.finditer(r'<a id="(article-\d+-item-\d+)"></a>\n\n\d+\. ([\s\S]*?)(?=\n\n<a id=|$)',value)}
prior_clauses = clauses(prior_source)
current_clauses = clauses(source)
assert len(prior_clauses)==135 and len(current_clauses)==138
unchanged_count=0
for key,value in prior_clauses.items():
    if key.startswith("article-12-"): continue
    target=renumber(key)
    expected=renumber(value).replace("[第12条](#article-12)","[第4章](#chapter-4)")
    assert expected == current_clauses[target], "Unexpected change outside scheduling: "+key
    unchanged_count+=1
assert unchanged_count == 125
moves = json.loads((SOURCE.parent/"SCHEDULING_MOVE_CHECKS_20261014_R6.json").read_text(encoding="utf-8"))
for move in moves:
    fragment=move["old_fragment"]
    assert fragment in prior_clauses[move["old_id"]]
    expected=renumber(fragment)
    for old_text,new_text in move["replacements"]:
        assert old_text in expected
        expected=expected.replace(old_text,new_text,1)
    assert expected.strip() == current_clauses[move["new_id"]],move["new_id"]
# Split fragments must cover the entire old clause once, without omission or duplication.
for key,clause in prior_clauses.items():
    if not key.startswith("article-12-"): continue
    parts=[move["old_fragment"] for move in moves if move["old_id"]==key]
    parts.sort(key=lambda part:clause.index(part))
    assert "".join(parts)==clause,"Missing/duplicated source text: "+key
assert len(moves)==13 and len({m["new_id"] for m in moves})==13
assert "下書き" not in source
prior_body = BeautifulSoup((ROOT/"terms/2026-11-20261014-r5/index.html").read_text(encoding="utf-8"),"html.parser")
assert [compact(renumber(t.get_text())) for t in prior_body.select("table")] == [compact(t.get_text()) for t in body.select("table")]
assert len(ids)==187
for link in body.select('a[href^="#article-"]'):
    label=re.fullmatch(r"第(\d+)条(?:第(\d+)項)?",link.get_text())
    if label:
        target="article-"+label[1]+("-item-"+label[2] if label[2] else "")
        assert link["href"]=="#"+target,"Reference label differs from anchor"
# Related blank forms and the waiver guide change only their references/version.
form_sources=["TEACHING_CONDITIONS_REGULAR.md","TEACHING_CONDITIONS_SPECIAL.md","TUITION_AGREEMENT.md","WAIVER_GUIDE.md"]
for filename in form_sources:
    original=subprocess.check_output(["git","show",PRIOR_COMMIT+":docs/terms-restructure-2026-11/"+filename],text=True)
    expected=renumber(original)
    if filename=="TUITION_AGREEMENT.md":
        expected=expected.replace("規約第12条によって","規約第4章に従って").replace("第9条～第12条","第9条～第16条")
    if filename=="WAIVER_GUIDE.md":
        expected=expected.replace("2026-11-20261012-r3","2026-11-20261014-r6").replace("2026年10月12日作成／2026年11月版受講規約に対応","2026年10月14日改訂／2026年11月版受講規約（r6）に対応")
    assert expected==(SOURCE.parent/filename).read_text(encoding="utf-8"),filename

html = '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>受講規約（2026年11月版・10月14日改訂）｜ステップワイズ個別指導</title><style>' + css + '</style></head><body>\n<nav class="tools" aria-label="規約の関連ページ"><a href="' + PDF_NAME + '">PDFで開く</a><a href="waiver/">免除申請のご案内</a><a href="../">規約の版一覧・旧版</a><a href="/">ステップワイズ個別指導</a></nav>\n<main id="contract">' + str(body) + '</main>\n</body></html>\n'
(OUT / "index.html").write_text(html, encoding="utf-8")

index_html = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>受講規約の版一覧｜ステップワイズ個別指導</title>
<style>body{font-family:"Yu Gothic","Noto Sans CJK JP",Meiryo,sans-serif;color:#172526;line-height:1.9;margin:36px auto;padding:0 22px;max-width:760px}h1{font-size:1.6rem}h2{font-size:1.2rem;border-bottom:1px solid #b9cdcb;padding-bottom:7px;margin-top:28px}a{color:#126964}li{margin:9px 0}.note{color:#405452}</style></head><body>
<p><a href="/">ステップワイズ個別指導</a></p><h1>受講規約の版一覧</h1>
<p>受講規約の本文とPDFをご確認いただけます。適用されるのは、ご家庭が同意した版です。掲載の更新だけで過去に同意した内容を置き換えることはありません。</p>
<h2>正式版：2026年11月版（2026年10月14日改訂・授業日時の調整と予約を独立章へ整理）</h2>
<p>適用開始日：2026年11月1日。全8章・36条。受講内容の合意と、授業日時の調整・予約を分けた版です。塾内部の「下書き」の説明を外し、料金や予約の条件は変えていません。</p>
<ul><li><a href="2026-11-20261014-r6/">Web版を読む</a></li><li><a href="2026-11-20261014-r6/stepwise-terms-2026-11-20261014-r6.pdf">PDFで開く</a></li></ul>
<h2>関連書類の空欄様式</h2>
<ul><li><a href="2026-11-20261014-r6/documents/regular/">受講条件書（通常指導）</a>（<a href="2026-11-20261014-r6/documents/regular/regular.pdf">PDF</a>）</li><li><a href="2026-11-20261014-r6/documents/special/">受講条件書（特殊指導）</a>（<a href="2026-11-20261014-r6/documents/special/special.pdf">PDF</a>）</li><li><a href="2026-11-20261014-r6/documents/agreement/">受講合意書</a>（<a href="2026-11-20261014-r6/documents/agreement/agreement.pdf">PDF</a>）</li></ul>
<h2>旧版：2026年11月版（2026年10月14日改訂・r5）</h2>
<p>契約書類の名称を受講条件書・受講合意書に統一した版です。</p>
<ul><li><a href="2026-11-20261014-r5/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261014-r5/stepwise-terms-2026-11-20261014-r5.pdf">旧版のPDFで開く</a></li></ul>
<p>当時の空欄様式：<a href="2026-11-20261014-r5/documents/regular/">通常指導</a>・<a href="2026-11-20261014-r5/documents/special/">特殊指導</a>・<a href="2026-11-20261014-r5/documents/agreement/">受講合意書</a>（各ページにPDF）。</p>
<h2>旧版：2026年11月版（2026年10月14日改訂・r4）</h2>
<p>授業予定の段階と予約を整理した版です。</p>
<ul><li><a href="2026-11-20261014-r4/">旧版のWeb版を読む</a></li><li><a href="2026-11-20261014-r4/stepwise-terms-2026-11-20261014-r4.pdf">旧版のPDFで開く</a></li></ul>
<h2>キャンセル料金の免除申請</h2>
<ul><li><a href="2026-11-20261014-r6/waiver/">免除申請のご案内を読む</a></li><li><a href="2026-11-20261014-r6/waiver/waiver.pdf">案内をPDFで開く</a></li></ul>
<p><a href="2026-11-20261012-r3/waiver/">旧案内（r3～r5の条番号）</a>も保存しています。</p>
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
        footer_template='<div style="width:100%;font-size:8px;color:#536563;text-align:center;font-family:sans-serif;">Stepwise / 2026-11-20261014-r6 &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        tagged=True, outline=True,
    )
    page.emulate_media(media="screen")
    page.set_viewport_size({"width":390,"height":844})
    page.screenshot(path=str(REVIEW / "mobile.png"))
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile overflow"
    page.locator("#article-18-item-3").scroll_into_view_if_needed()
    page.screenshot(path=str(REVIEW / "mobile-fees.png"))
    for table in page.locator("table").all():
        assert table.bounding_box()["width"] <= 354, "Mobile table overflow"
    page.locator("#article-12-item-2").scroll_into_view_if_needed()
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
    "chapters":8,"articles":36,"numbered_paragraphs":138,"tables":3,
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
report["preserved_clauses_after_reference_update"] = unchanged_count
report["scheduling_fragments_verified"] = len(moves)
report["removed_internal_draft_explanation_only"] = True
report["tables_unchanged_after_reference_update"] = True
report["related_documents_reference_only_change"] = True
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


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
        page.pdf(path=str(dest/(slug+".pdf")),format="A4",prefer_css_page_size=True,print_background=True,display_header_footer=True,header_template="<span></span>",footer_template='<div style="width:100%;font:8px sans-serif;text-align:center">Stepwise / 20261014-r6 / '+slug+'　<span class="pageNumber"></span> / <span class="totalPages"></span></div>',tagged=True)
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
print(json.dumps(report,ensure_ascii=False,indent=2))
