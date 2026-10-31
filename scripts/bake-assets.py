"""런타임 픽셀 가공을 없애기 위해 동전 텍스처와 한지 결 텍스처를 미리 구워 둔다.

    python scripts/bake-assets.py

입력: assets-src/coin-front.png, assets-src/coin-back.png (실물 동전 사진)
출력: src/assets/coin-front.webp, src/assets/coin-back.webp, src/assets/hanji-grain.webp

동전 가공은 예전 런타임 loadTex()와 같은 결과를 낸다.
  1) 동전 안쪽(반경 40%)의 너무 밝지 않은 픽셀 평균색을 0.6배로 어둡게 → 바탕색
  2) 바탕색 위에 사진을 다시 얹고, 밝은 픽셀(>160)은 바탕색으로 덮는다
  3) 가운데 네모 구멍의 밝은 픽셀은 알파 0 으로(three.js alphaTest 로 실제 구멍처럼 보이게)
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets-src")
OUT = os.path.join(ROOT, "src", "assets")
SIZE = 256


def bake_coin(name):
    img = Image.open(os.path.join(SRC, f"{name}.png")).convert("RGBA")
    size = max(img.size)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    px = canvas.load()

    cx = cy = size / 2
    r = size * 0.4
    rs = gs = bs = n = 0
    for y in range(0, size, 2):
        for x in range(0, size, 2):
            if math.hypot(x - cx, y - cy) > r:
                continue
            pr, pg, pb, pa = px[x, y]
            if pa > 0 and (pr + pg + pb) / 3 < 200:
                rs += pr; gs += pg; bs += pb; n += 1
    avg = tuple(round(v / n * 0.6) for v in (rs, gs, bs))

    base = Image.new("RGBA", (size, size), avg + (255,))
    base.alpha_composite(canvas)
    bp = base.load()
    hole = size * 0.17  # 사진 속 네모 구멍 반폭(약간 여유)
    for y in range(size):
        for x in range(size):
            pr, pg, pb, _ = bp[x, y]
            if (pr + pg + pb) / 3 > 160:
                in_hole = abs(x - cx) < hole and abs(y - cy) < hole
                bp[x, y] = avg + ((0,) if in_hole else (255,))
    out = base.resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT, f"{name}.webp")
    out.save(path, "WEBP", quality=88, method=6)
    print(path, os.path.getsize(path), "bytes")


def bake_grain():
    """한지 결: 대부분 투명, 가는 섬유와 티끌만 반투명. 이음매 없이 반복되도록 감싸 그린다."""
    rng = random.Random(1031)
    s = 384
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def wrapped_line(points, fill, width):
        for ox in (-s, 0, s):
            for oy in (-s, 0, s):
                d.line([(x + ox, y + oy) for x, y in points], fill=fill, width=width)

    for i in range(220):  # 섬유
        x, y = rng.uniform(0, s), rng.uniform(0, s)
        ang = rng.uniform(0, math.pi)
        length = rng.uniform(22, 74)
        pts = []
        for k in range(8):
            t = k / 7 * length
            bend = math.sin(k / 7 * math.pi) * rng.uniform(-6, 6)
            pts.append((x + math.cos(ang) * t - math.sin(ang) * bend, y + math.sin(ang) * t + math.cos(ang) * bend))
        light = rng.random() < 0.8
        a = rng.randint(12, 30)
        wrapped_line(pts, (255, 250, 238, a) if light else (40, 28, 18, a), 1)

    for i in range(420):  # 티끌
        x, y = rng.uniform(0, s), rng.uniform(0, s)
        rr = rng.uniform(0.4, 1.3)
        a = rng.randint(10, 30)
        col = (30, 22, 14, a) if rng.random() < 0.7 else (255, 250, 238, a)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)

    layer = layer.filter(ImageFilter.GaussianBlur(0.7))
    path = os.path.join(OUT, "hanji-grain.webp")
    layer.save(path, "WEBP", quality=80, method=6)
    print(path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    bake_coin("coin-front")
    bake_coin("coin-back")
    bake_grain()
