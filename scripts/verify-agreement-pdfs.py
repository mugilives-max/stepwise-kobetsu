"""Verify every synthetic PDF page and emit PNGs on the isolated GitHub runner."""
from pathlib import Path
import json
import subprocess
import fitz
root = Path("agreement-document-output")
report = {}
for path in sorted(root.glob("*.pdf")):
    doc = fitz.open(path)
    texts = []
    for i, page in enumerate(doc):
        text = page.get_text()
        assert text.strip(), f"{path.name} blank page {i+1}"
        assert "\ufffd" not in text, f"{path.name} replacement glyph"
        assert abs(page.rect.width-595.28)<2 and abs(page.rect.height-841.89)<2
        for word in page.get_text("words"):
            x0,y0,x1,y1 = word[:4]
            assert x0>=25 and y0>=20 and x1<=page.rect.width-25 and y1<=page.rect.height-8, (path.name,i,word)
        texts.append(text)
    subprocess.run(["pdftoppm","-r","100","-png",str(path),str(root/path.stem)],check=True)
    combined = "\n".join(texts)
    for required in ["受講合意書", "対象期間", "予定総額", "提案・承認の記録", "ステップワイズ個別指導"]:
        assert required in combined, (path.name, required)
    if path.stem == "approved":
        assert "31,500円" in combined and "13,500円" in combined
        assert "【テスト】架空 保護者" in combined
    if path.stem == "long-history":
        for i in range(3):
            assert f"末尾確認{i}" in combined
        assert "時刻の記録なし" in combined
    report[path.name] = {"pages":len(doc),"characters":len(combined),"a4":True,"text_bounds":True}
(root/"pdf-checks.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
