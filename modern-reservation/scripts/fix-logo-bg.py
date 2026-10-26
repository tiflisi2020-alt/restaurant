from PIL import Image
from pathlib import Path

base = Path(__file__).resolve().parents[1] / "public"
src = Image.open(base / "logo.png").convert("RGBA")
pixels = src.load()
w, h = src.size

trans = Image.new("RGBA", (w, h), (0, 0, 0, 0))
tp = trans.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        # Keep teal/colored ink; drop near-black plate
        if lum < 48 and g < 60:
            tp[x, y] = (0, 0, 0, 0)
        else:
            tp[x, y] = (r, g, b, a)

trans.save(base / "logo-mark.png", "PNG")

# White-background version for <img> (do NOT overwrite logo.png — CSS mask needs dark plate)
white_bg = Image.new("RGBA", (w, h), (255, 253, 248, 255))
white_bg.alpha_composite(trans)
white_bg.convert("RGB").save(base / "logo-white.png", "PNG")


def make_icon(size: int, pad_ratio: float, path: Path) -> None:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    pad = int(size * pad_ratio)
    box = size - 2 * pad
    scale = min(box / w, box / h)
    dw, dh = int(round(w * scale)), int(round(h * scale))
    resized = trans.resize((dw, dh), Image.Resampling.LANCZOS)
    dx, dy = (size - dw) // 2, (size - dh) // 2
    canvas.alpha_composite(resized, (dx, dy))
    canvas.convert("RGB").save(path, "PNG")
    print(f"wrote {path.name} logo={dw}x{dh}")


make_icon(192, 0.10, base / "icon-192.png")
make_icon(512, 0.10, base / "icon-512.png")
make_icon(512, 0.18, base / "icon-512-maskable.png")

for name in ["icon-192.png", "logo-white.png", "logo-mark.png", "logo.png"]:
    im = Image.open(base / name).convert("RGBA")
    c = im.getpixel((2, 2))
    mid = im.getpixel((im.width // 2, im.height // 2))
    print(f"{name}: corner={c} center={mid}")

print("done")
