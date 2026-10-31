"""런타임 픽셀 가공을 없애기 위해 동전 텍스처와 한지 결 텍스처를 미리 구워 둔다.

    python scripts/bake-assets.py          (Pillow, numpy, scipy 필요)

입력: assets-src/coin-front.png, assets-src/coin-back.png (실물 동전 사진, 약 200px)
출력: src/assets/coin-{front,back}.webp        색(512px, 네모 구멍은 알파 0)
      src/assets/coin-{front,back}-normal.webp 양각 노멀맵(512px)
      src/assets/coin-{front,back}-orm.webp    R=가림(AO) G=거칠기 B=금속성(256px, three.js aoMap·roughnessMap·metalnessMap)
      src/assets/hanji-grain.webp

동전 가공
  1) 사진에서 동전 원을 찾아 가운데로 맞추고 512px 로 키운다(텍스처 원 = 동전 면).
  2) 높이맵: 바깥 테·네모 구멍 둘레 테(기하로 그림) + 앞면 글자(開元通寶). 글자는 사진 명도·붉은 기의
     국소 대비(high-pass)에서 뽑아 작은 티끌을 지운다. 부드럽게 흐려 모서리가 둥근 양각이 되게 한다.
  3) 색: 도드라진 곳은 손에 닳아 빛나는 청동(금빛), 바탕은 녹이 낀 무광.
     앞면은 밝은 청동 바탕에 글자가 금빛으로, 뒷면은 글자 없이 조금 더 어둡고 녹청(초록 기)이 돈다.
  4) 거칠기·금속성: 도드라진 곳은 매끈하고 금속성이 높고, 바탕은 거칠고 금속성이 낮다.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets-src")
OUT = os.path.join(ROOT, "src", "assets")
SIZE = 512
ORM_SIZE = 256

# 면별 값: 바깥 테 안쪽 반경, 네모 구멍 반폭(동전 반경 비), 글자 유무, 바탕 색조(목표색, 섞는 비율, 밝기 배율),
# 도드라진 곳 청동색과 섞는 비율, 거칠기(바탕/도드라진 곳), 금속성(바탕/도드라진 곳)
FACES = {
    "coin-front": dict(rim_in=0.85, hole=0.33, glyphs=True, field=((122, 88, 56), 0.55, 0.86),
                       relief=0.6, rough=(0.72, 0.32), metal=(0.4, 0.9)),
    "coin-back": dict(rim_in=0.81, hole=0.30, glyphs=False, field=((52, 78, 66), 0.5, 0.8),
                      relief=0.3, rough=(0.82, 0.4), metal=(0.3, 0.8)),
}
BRONZE = np.array([184.0, 140.0, 80.0])  # 닳아 빛나는 청동(금빛)


def load_centered(name):
    """사진에서 동전 원(흰 바탕이 아닌 부분)을 찾아 가운데로 맞춰 SIZE 로 키운다"""
    im = Image.open(os.path.join(SRC, f"{name}.png")).convert("RGBA")
    a = np.asarray(im).astype(float)
    lum = a[:, :, :3].mean(2)
    ys, xs = np.nonzero((lum < 200) & (a[:, :, 3] > 0))
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    r = ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 4
    box = tuple(int(round(v)) for v in (cx - r, cy - r, cx + r, cy + r))
    return np.asarray(im.crop(box).resize((SIZE, SIZE), Image.LANCZOS)).astype(float)


def height_map(a, f):
    n = a.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    u, v = (xx - n / 2 + 0.5) / (n / 2), (yy - n / 2 + 0.5) / (n / 2)
    rr, sq = np.hypot(u, v), np.maximum(abs(u), abs(v))
    h = np.clip((rr - f["rim_in"]) / 0.025, 0, 1) * np.clip((0.995 - rr) / 0.02, 0, 1)  # 바깥 테
    hr = f["hole"] + 0.075
    h = np.maximum(h, np.clip((hr - sq) / 0.02, 0, 1) * np.clip((sq - f["hole"] + 0.01) / 0.01, 0, 1))  # 구멍 둘레 테
    if f["glyphs"]:
        lum = a[:, :, :3].mean(2)
        red = a[:, :, 0] - a[:, :, 2]
        hp = nd.gaussian_filter(lum, 1.2) - nd.gaussian_filter(lum, 10)
        hp2 = nd.gaussian_filter(red, 1.5) - nd.gaussian_filter(red, 12)
        score = hp / (hp.std() + 1e-6) + 0.8 * hp2 / (hp2.std() + 1e-6)
        field = (rr < f["rim_in"] - 0.03) & (sq > hr + 0.02)
        g = (np.clip((score - 0.2) / 1.2, 0, 1) * field) > 0.3
        g = nd.binary_closing(nd.binary_opening(g, iterations=1), iterations=2)
        lab, k = nd.label(g)
        sizes = nd.sum(g, lab, range(1, k + 1))
        g = np.isin(lab, np.nonzero(sizes > 100)[0] + 1)
        h = np.maximum(h, g * 0.9)
    return nd.gaussian_filter(h, 1.6), rr, sq


def save(arr, name, size, quality=90):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, "WEBP", quality=quality, method=6)
    print(path, os.path.getsize(path), "bytes")


def bake_coin(name):
    f = FACES[name]
    a = load_centered(name)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    h, rr, sq = height_map(a, f)
    lum = rgb.mean(2)

    # 색: 사진의 결(명도 변화)은 남기고 색조만 옮긴다. 흰 바탕·구멍은 바탕색으로 채운 뒤 구멍만 투명하게
    inside = (lum < 160) & (alpha > 0) & (rr < 0.99)
    patina = rgb[inside].mean(0)
    detail = (lum / max(1.0, lum[inside].mean()))[..., None]
    detail = np.where(inside[..., None], detail, 1.0)
    base = np.where(inside[..., None], rgb, patina)
    tint, mix, gain = f["field"]
    field = (base * (1 - mix) + np.array(tint) * detail * mix) * gain
    w = (h * f["relief"])[..., None]
    col = field * (1 - w) + BRONZE * np.clip(detail, 0.6, 1.3) ** 0.6 * w
    hole = sq < f["hole"] - 0.005
    out = np.dstack([col, np.where(hole, 0, 255)])
    save(out, f"{name}.webp", SIZE, 90)

    # 노멀맵(탄젠트 공간, +Y = 텍스처 위쪽). k 는 양각 경사 세기(판 위 작은 동전에서도 글자 그림자가 보일 만큼)
    k = 3.2
    dy, dx = np.gradient(h)
    nx, ny, nz = -dx * k, dy * k, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    save(np.dstack([(nx / ln + 1) * 127.5, (ny / ln + 1) * 127.5, (nz / ln + 1) * 127.5]), f"{name}-normal.webp", SIZE, 92)

    # 가림(도드라진 곳 발치가 조금 어둡게)·거칠기·금속성
    ao = 1 - 0.35 * np.clip(nd.gaussian_filter(h, 4) - h, 0, 1) * 3
    rough = f["rough"][0] + (f["rough"][1] - f["rough"][0]) * h
    metal = f["metal"][0] + (f["metal"][1] - f["metal"][0]) * h
    save(np.dstack([np.clip(ao, 0, 1) * 255, rough * 255, metal * 255]), f"{name}-orm.webp", ORM_SIZE, 92)


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
