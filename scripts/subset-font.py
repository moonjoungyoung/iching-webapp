"""莫大毛筆(Bakudai Bold) 서예 폰트를 실제로 쓰는 글자만 남겨 작게 만든다.

    python scripts/subset-font.py

원본(약 8.2MB): assets-src/fonts/Bakudai-Bold.woff2
결과:           src/assets/fonts/bakudai-subset.woff2  (Vite 가 해시 파일명으로 내보낸다)

index.html, src/**/*.js, src/**/*.css 에 나오는 모든 글자를 모은다.
화면에 새 한자 문구를 넣었다면 이 스크립트를 다시 돌려야 붓글씨로 보인다.
(폰트에 없는 글자, 예를 들어 한글은 자동으로 빠지고 브라우저가 대체 글꼴로 그린다.)
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_FONT = os.path.join(ROOT, "assets-src", "fonts", "Bakudai-Bold.woff2")
OUT_FONT = os.path.join(ROOT, "src", "assets", "fonts", "bakudai-subset.woff2")


def collect_chars():
    files = [os.path.join(ROOT, "index.html")]
    for ext in ("js", "css"):
        files += glob.glob(os.path.join(ROOT, "src", "**", f"*.{ext}"), recursive=True)
    chars = set()
    for f in files:
        with open(f, encoding="utf-8") as fh:
            chars.update(fh.read())
    # 기본 라틴·숫자·문장부호는 항상 포함
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update("·「」『』〈〉《》、。○◆")
    return "".join(sorted(c for c in chars if c.isprintable() and not c.isspace() or c == " "))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    text = collect_chars()
    cjk = [c for c in text if "㐀" <= c <= "鿿" or "豈" <= c <= "﫿"]
    os.makedirs(os.path.dirname(OUT_FONT), exist_ok=True)
    cmd = [
        sys.executable, "-m", "fontTools.subset", SRC_FONT,
        f"--text={text}",
        "--flavor=woff2",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        f"--output-file={OUT_FONT}",
    ]
    subprocess.run(cmd, check=True)
    print(f"한자 {len(cjk)}자 포함, 전체 {len(text)}자 후보")
    print(f"{SRC_FONT} {os.path.getsize(SRC_FONT):,} bytes")
    print(f"{OUT_FONT} {os.path.getsize(OUT_FONT):,} bytes")


if __name__ == "__main__":
    main()
