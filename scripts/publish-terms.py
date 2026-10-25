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
EDITION = "2026-11-20261025-r10"
SOURCE = ROOT / "docs/terms-restructure-2026-11/TERMS.md"
OUT = ROOT / "terms" / EDITION
REVIEW = ROOT / "docs/terms-restructure-2026-11/publication-preview-20261025-r10"
REPORT = ROOT / "docs/terms-restructure-2026-11/PUBLICATION_CHECKS_20261025_R10.json"
PDF_NAME = "stepwise-terms-" + EDITION + ".pdf"
EXPECTED_SOURCE_BLOB = "ea6719873df439df51ae9f546b8843b609125f31"
OLD = {}  # 2026-10-18 同意のない旧版はサイトから外した（控えは本人のドライブ）。ご家庭が同意した版を残すときは、ここで変わっていないことを確かめる

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
# r10 (2026-10-25 本人「顧客からしてもわかりやすい名前が良い」→「ご利用規約」、「関係ない情報が多すぎませんか（顧客目線に立っていない）版とか、名前を変えただとか」):
# r9 から、名前・保護者に見せていた版の行・版の参照だけを変えた版。
# r9 の本文に決まった置き換えだけをしたものと、今の本文が一字一句同じであることを確かめる（条文・表・例は変わらない）
PRIOR_COMMIT = "994f6c956127d073c6ee4e9a9c8b29415081db70"
TERMS_REPLACEMENTS = [('# 受講規約（2026年11月版）', '# ご利用規約'), ('**版：2026年11月版（2026年10月15日改訂・共通の受講条件と特別単価の合意を整理）**  \n**適用開始日：2026年11月1日**', '**2026年11月1日から適用します。**'), ('2026年11月版（適用日 2026年11月1日）', '2026年11月1日から適用'), ('20261015-r9', '20261025-r10')]
RELATED_REPLACEMENTS = [('**ステップワイズ個別指導／2026年10月15日改訂／2026年11月版受講規約（r9）に対応**', '**ステップワイズ個別指導**'), ('受講規約', 'ご利用規約'), ('20261015-r9', '20261025-r10'), ('（r9）', '（r10）'), ('2026年10月15日改訂', '2026年10月25日改訂')]
prior_source = subprocess.check_output(["git","show",PRIOR_COMMIT+":docs/terms-restructure-2026-11/TERMS.md"],text=True)
expected_source = prior_source
for old,new in TERMS_REPLACEMENTS:
    assert old in expected_source, old
    expected_source = expected_source.replace(old,new)
assert expected_source==source, "Unexpected changes besides the name and edition references"
CLAUSE_PATTERN = r'(<a id="(article-\d+-item-\d+)"></a>\n\n\d+\. )([\s\S]*?)(?=\n\n<a id=|$)'
def clauses(value):
    return {m[2]:m[3].strip() for m in re.finditer(CLAUSE_PATTERN,value)}
old_clauses,new_clauses = clauses(prior_source),clauses(source)
assert len(old_clauses)==151 and set(old_clauses)==set(new_clauses)
changes={k for k in old_clauses if old_clauses[k]!=new_clauses[k]}
assert all("20261025-r10" in new_clauses[k] for k in changes) and len(changes)<=1, changes
old_tables=re.findall(r"(?m)^\|.*(?:\n\|.*)*",prior_source)
new_tables=re.findall(r"(?m)^\|.*(?:\n\|.*)*",source)
assert old_tables==new_tables, "Tables changed"
for phrase in ["特殊指導","通常指導","受講条件書（","受講規約"]:
    assert phrase not in source,phrase
assert len(ids)==196
for link in body.select('a[href^="#article-"]'):
    label=re.fullmatch(r"第(\d+)条(?:第(\d+)項)?",link.get_text())
    if label:
        target="article-"+label[1]+("-item-"+label[2] if label[2] else "")
        assert link["href"]=="#"+target,"Reference label differs from anchor"
waiver_url="https://www.stepwise-education.jp/terms/2026-11-20261025-r10/waiver/"
assert [a["href"] for a in body.select("a[href]") if "/waiver/" in a["href"]] == [waiver_url]
for filename in ["TEACHING_CONDITIONS_REGULAR.md","TEACHING_CONDITIONS_SPECIAL.md","TUITION_AGREEMENT.md","WAIVER_GUIDE.md"]:
    before=subprocess.check_output(["git","show",PRIOR_COMMIT+":"+str(SOURCE.parent.relative_to(ROOT)/filename)],text=True)
    for old,new in RELATED_REPLACEMENTS:
        before=before.replace(old,new)
    after=(SOURCE.parent/filename).read_text(encoding="utf-8")
    assert before==after and not any(phrase in after for phrase in ["特殊指導","通常指導","受講条件書（","受講規約"]),filename

html = '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>ご利用規約｜ステップワイズ個別指導</title><style>' + css + '</style></head><body>\n<nav class="tools" aria-label="規約の関連ページ"><a href="' + PDF_NAME + '">PDFで開く</a><a href="waiver/">免除申請のご案内</a><a href="../">ご利用規約と書類の一覧</a><a href="/">ステップワイズ個別指導</a></nav>\n<main id="contract">' + str(body) + '</main>\n</body></html>\n'
(OUT / "index.html").write_text(html, encoding="utf-8")

# 2026-10-18 本人「過去のご利用規約が全部見れちゃうのなんか嫌」: サイトの一覧には正式版だけを出す。旧版は、ご家庭が同意した版だけを残す
# （同意のない作成途中の版はサイトに載せない。外した版の控えは本人のドライブ Kura/塾/ご利用規約/旧版_サイトから外した版_20261018）
index_html = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>ご利用規約｜ステップワイズ個別指導</title>
<style>body{font-family:"Yu Gothic","Noto Sans CJK JP",Meiryo,sans-serif;color:#172526;line-height:1.9;margin:36px auto;padding:0 22px;max-width:760px}h1{font-size:1.6rem}h2{font-size:1.2rem;border-bottom:1px solid #b9cdcb;padding-bottom:7px;margin-top:28px}a{color:#126964}li{margin:9px 0}.note{color:#405452}</style></head><body>
<p><a href="/">ステップワイズ個別指導</a></p><h1>ご利用規約</h1>
<p>すべてのご家庭に共通の、当塾のきまりです。お子さまごとの条件は「受講条件書」、月ごとの授業の内容は「受講合意書」で定めます。</p>
<h2>ご利用規約（2026年11月1日から適用）</h2>
<ul><li><a href="2026-11-20261025-r10/">Web版を読む</a></li><li><a href="2026-11-20261025-r10/stepwise-terms-2026-11-20261025-r10.pdf">PDFで開く</a></li></ul>
<h2>書類の様式</h2>
<ul><li><a href="2026-11-20261025-r10/documents/regular/">受講条件書</a>（<a href="2026-11-20261025-r10/documents/regular/regular.pdf">PDF</a>）</li><li><a href="2026-11-20261025-r10/documents/special/">特別単価合意書</a>（<a href="2026-11-20261025-r10/documents/special/special.pdf">PDF</a>）</li><li><a href="2026-11-20261025-r10/documents/agreement/">受講合意書</a>（<a href="2026-11-20261025-r10/documents/agreement/agreement.pdf">PDF</a>）</li></ul>
<h2>キャンセル料金の免除申請</h2>
<ul><li><a href="2026-11-20261025-r10/waiver/">免除申請のご案内を読む</a></li><li><a href="2026-11-20261025-r10/waiver/waiver.pdf">案内をPDFで開く</a></li></ul>
<p class="note">ご不明な点は、いつものLINE、または <a href="mailto:mugilives@gmail.com">mugilives@gmail.com</a> へお問い合わせください。</p>
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
        footer_template='<div style="width:100%;font-size:8px;color:#536563;text-align:center;font-family:sans-serif;">ステップワイズ個別指導　ご利用規約 &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
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
report["reviewed_changed_paragraphs"] = len(changes)
report["unchanged_paragraphs"] = len(old_clauses)-len(changes)
report["only_reviewed_source_changes"] = True
report["deferred_conditions_unchanged"] = True
report["fee_tables_and_examples_unchanged"] = True
report["related_documents_reviewed_text_equal"] = True
report["preparation_distribution_unchanged"] = True
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
        if slug=="agreement": form_css+="\n@media print { th,td { padding:3pt 5pt; } }"
        if slug=="waiver": form_css=css
        form_html='<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>'+title+'｜ステップワイズ個別指導</title><style>'+form_css+'</style></head><body><nav class="tools"><a href="'+slug+'.pdf">PDFで開く</a><a href="../../">ご利用規約</a><a href="../../../">ご利用規約と書類の一覧</a></nav><main>'+str(form_body)+'</main></body></html>'
        if slug=="waiver":
            form_html=form_html.replace('href="../../">ご利用規約','href="../">ご利用規約').replace('href="../../../">ご利用規約と書類の一覧','href="../../">ご利用規約と書類の一覧')
        (dest/"index.html").write_text(form_html,encoding="utf-8")
        page.goto((dest/"index.html").as_uri());page.evaluate("document.fonts.ready")
        page.pdf(path=str(dest/(slug+".pdf")),format="A4",prefer_css_page_size=True,print_background=True,display_header_footer=True,header_template="<span></span>",footer_template='<div style="width:100%;font:8px sans-serif;text-align:center">ステップワイズ個別指導　'+title+'　<span class="pageNumber"></span> / <span class="totalPages"></span></div>',tagged=True)
        page.set_viewport_size({"width":320,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),slug
        page.screenshot(path=str(REVIEW/(slug+"-mobile.png")))
        doc=fitz.open(dest/(slug+".pdf"))
        if slug!="waiver": assert len(doc)==1,(slug,"Blank form must fit on one page")
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
