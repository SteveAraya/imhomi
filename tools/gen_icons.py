#!/usr/bin/env python3
"""Genera el set de iconos de imhomi.com.

    pip install pillow
    python3 tools/gen_icons.py

Criterio de diseno
------------------
El favicon es el GLIFO SOLO, sin mosaico ni disco, sangrando al borde sobre
fondo transparente. Google ya dibuja el icono dentro de su propio circulo
blanco de 28px en los resultados de busqueda: cualquier contenedor que traiga
el archivo produce dos formas concentricas compitiendo.

Los iconos de app son la excepcion y si llevan fondo, porque iOS y Android
exigen un cuadrado opaco. Ahi el glifo va sobre el navy de marca.

Todo se dibuja en RAW=2048 y se reduce una sola vez con LANCZOS. El encuadre
se calcula por bounding box, de modo que el PNG y el SVG queden alineados.
"""
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent   # raiz del repo

RAW = 2048      # lienzo de dibujo del glifo
N = 1024        # maestro del que sale cada PNG

# los dos teales de la marca; el extremo oscuro es el que sostiene el
# contraste contra el circulo blanco de Google
GRAD = ("#4ECDC4", "#22887C")
GROUND = "#0F2329"

# FILL_ICON  0.94 -> el glifo sangra; no queda aire entre la marca y el circulo
# FILL_APP   0.58 -> aire para el redondeo que aplica iOS
# FILL_MASK  0.44 -> zona segura del 40% que recorta Android
FILL_ICON, FILL_APP, FILL_MASK = 0.94, 0.58, 0.44

TARGETS = [
    ("favicon-96.png", None, FILL_ICON, 96),
    ("icon-192.png", GROUND, FILL_APP, 192),
    ("icon-512.png", GROUND, FILL_APP, 512),
    ("icon-maskable-512.png", GROUND, FILL_MASK, 512),
    ("apple-touch-icon.png", GROUND, FILL_APP, 180),
]


# --------------------------------------------------------------- color y fondo
def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def gradient(c0, c1, size):
    """Rampa a 135 grados (arriba-izq -> abajo-der)."""
    img = Image.new("RGB", (size, size))
    pix = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1))
            pix[x, y] = (
                round(c0[0] + (c1[0] - c0[0]) * t),
                round(c0[1] + (c1[1] - c0[1]) * t),
                round(c0[2] + (c1[2] - c0[2]) * t),
            )
    return img


# ---------------------------------------------------------------------- glifo
# Casa solida con alero y puerta calada, en una grilla logica de 100x100.
HOUSE_PTS = [(50, 16), (90, 52), (78, 52), (78, 84), (22, 84), (22, 52), (10, 52)]
HOUSE_BBOX = (10, 16, 90, 84)


def house_mask():
    u = RAW / 100.0
    m = Image.new("L", (RAW, RAW), 0)
    d = ImageDraw.Draw(m)
    d.polygon([(x * u, y * u) for x, y in HOUSE_PTS], fill=255)
    # puerta: rectangulo con el remate superior semicircular
    d.rounded_rectangle([41 * u, 58 * u, 59 * u, 85 * u], radius=9 * u, fill=0)
    d.rectangle([41 * u, 74 * u, 59 * u, 85 * u], fill=0)
    return m


def house_path(s, tx, ty):
    """Mismo dibujo como path SVG, con la transformada ya aplicada."""
    def T(x, y):
        return f"{s * x + tx:.4g} {s * y + ty:.4g}"

    outer = "M" + " L".join(T(x, y) for x, y in HOUSE_PTS) + " Z"
    door = (f"M{T(41, 84)} L{T(41, 67)} "
            f"A{s * 9:.4g} {s * 9:.4g} 0 0 1 {T(59, 67)} L{T(59, 84)} Z")
    return outer + " " + door


# ------------------------------------------------------------------- encuadre
def fit(raw, fill):
    """Escala el glifo por bounding box a `fill` del lienzo y lo centra."""
    g = raw.crop(raw.getbbox())
    w, h = g.size
    s = (fill * N) / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    g = g.resize((nw, nh), Image.LANCZOS)
    out = Image.new("L", (N, N), 0)
    out.paste(g, ((N - nw) // 2, (N - nh) // 2))
    return out


def place(bbox, fill):
    """El mismo encuadre que fit(), como (escala, tx, ty) en la grilla 0-100."""
    x0d, y0d, x1d, y1d = bbox
    w, h = x1d - x0d, y1d - y0d
    s = (fill * 100.0) / max(w, h)
    x0 = (100.0 - w * s) / 2.0
    y0 = (100.0 - h * s) / 2.0
    return s, x0 - s * x0d, y0 - s * y0d


# --------------------------------------------------------------------- salida
def compose(mask, grad, ground):
    """Glifo relleno con el gradiente. `ground` None => fondo transparente."""
    if ground is None:
        img = grad.copy().convert("RGBA")
        img.putalpha(mask)
        return img
    img = Image.new("RGB", (N, N), ground)
    img.paste(grad, (0, 0), mask)
    return img.convert("RGBA")


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


def write_ico(master, path, sizes=(16, 32, 48)):
    """ICO con un PNG por tamano, cada uno reducido desde el maestro."""
    frames = []
    for sz in sizes:
        buf = io.BytesIO()
        down(master, sz).save(buf, format="PNG", optimize=True)
        frames.append((sz, buf.getvalue()))
    out = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    for sz, data in frames:
        out += struct.pack("<BBBBHHII", sz, sz, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.write_bytes(out + b"".join(d for _, d in frames))


def main():
    grad = gradient(rgb(GRAD[0]), rgb(GRAD[1]), N)
    raw = house_mask()

    masters = {}
    for _, ground, fill, _ in TARGETS:
        if fill not in masters:
            masters[fill] = compose(fit(raw, fill), grad,
                                    None if ground is None else rgb(ground))

    for fname, ground, fill, size in TARGETS:
        img = down(masters[fill], size)
        if ground is not None:
            img = img.convert("RGB")      # iOS / Android: opaco, sin alfa
        img.save(ROOT / fname, format="PNG", optimize=True)
        print("  ", fname)

    write_ico(masters[FILL_ICON], ROOT / "favicon.ico")
    print("   favicon.ico")

    # la rampa se define sobre el lienzo completo (userSpaceOnUse) igual que en
    # el PNG; con objectBoundingBox se comprimiria al bbox del glifo
    d = house_path(*place(HOUSE_BBOX, FILL_ICON))
    (ROOT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
        '  <defs>\n'
        '    <linearGradient id="g" gradientUnits="userSpaceOnUse"'
        ' x1="0" y1="0" x2="100" y2="100">\n'
        f'      <stop offset="0" stop-color="{GRAD[0]}"/>\n'
        f'      <stop offset="1" stop-color="{GRAD[1]}"/>\n'
        '    </linearGradient>\n'
        '  </defs>\n'
        f'  <path fill="url(#g)" fill-rule="evenodd" d="{d}"/>\n'
        '</svg>\n'
    )
    print("   favicon.svg")


if __name__ == "__main__":
    main()
