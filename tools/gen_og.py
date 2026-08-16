#!/usr/bin/env python3
"""Genera og-image.png, la vista previa al compartir imhomi.com.

    pip install pillow
    python3 tools/gen_og.py

1200x630 es la relacion 1.91:1 que esperan WhatsApp, LinkedIn, Slack y X.
Varias plataformas recortan a formatos mas cuadrados, asi que el texto se
mantiene dentro del margen de 76px y nada importante toca el borde.

Reutiliza el glifo y la paleta de gen_icons.py para no tener dos definiciones
de la marca conviviendo en el repo.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from gen_icons import GRAD, GROUND, gradient, house_mask, rgb

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

W, H = 1200, 630
PAD = 76
BAR = 8                      # franja de marca al pie

BOLD = HERE / "SpaceGrotesk-Bold.ttf"
MEDIUM = HERE / "SpaceGrotesk-Medium.ttf"

WORDMARK = "ImHomi"
HEADLINE = "Todo lo que pasa en un alquiler, en una sola app"
SUB = "Desde buscar cuarto hasta liquidar el depósito. Incluso si ya estás alquilando."
DOMAIN = "imhomi.com"

TEXT = "#FFFFFF"
MUTED = "#93AEB4"            # el navy de marca aclarado, no un gris neutro


# ------------------------------------------------------------------ auxiliares
def wrap(draw, text, font, maxw):
    lines, cur = [], ""
    for word in text.split():
        probe = f"{cur} {word}".strip()
        if not cur or draw.textlength(probe, font=font) <= maxw:
            cur = probe
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def radial(size, falloff=2.2):
    """Mascara circular con caida suave, construida chica y ampliada."""
    r = 256
    m = Image.new("L", (r, r), 0)
    px = m.load()
    c = (r - 1) / 2.0
    for y in range(r):
        for x in range(r):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5 / c
            px[x, y] = 0 if d >= 1 else int(255 * (1 - d) ** falloff)
    return m.resize(size, Image.BICUBIC)


def glyph_image(height):
    """La casa de gen_icons.py, con el gradiente de marca, a la altura pedida."""
    raw = house_mask()
    mask = raw.crop(raw.getbbox())
    w = max(1, round(mask.width * height / mask.height))
    mask = mask.resize((w, height), Image.LANCZOS)
    art = gradient(rgb(GRAD[0]), rgb(GRAD[1]), max(w, height)).resize((w, height))
    art = art.convert("RGBA")
    art.putalpha(mask)
    return art


def main():
    ground = rgb(GROUND)
    img = Image.new("RGB", (W, H), ground)

    # halo de marca abajo a la derecha: da profundidad sin competir con el texto
    gw, gh = 900, 900
    halo = Image.new("RGB", (gw, gh), rgb(GRAD[1]))
    img.paste(halo, (W - gw + 260, H - gh + 300),
              radial((gw, gh)).point(lambda p: int(p * 0.30)))

    draw = ImageDraw.Draw(img)
    f_mark = ImageFont.truetype(str(BOLD), 42)
    f_head = ImageFont.truetype(str(BOLD), 66)
    f_sub = ImageFont.truetype(str(MEDIUM), 26)
    f_dom = ImageFont.truetype(str(MEDIUM), 22)

    # ---- lockup: glifo + nombre, alineados por centro optico
    mark = glyph_image(62)
    img.paste(mark, (PAD, PAD), mark)
    draw.text((PAD + mark.width + 22, PAD + mark.height / 2), WORDMARK,
              font=f_mark, fill=TEXT, anchor="lm")

    draw.text((W - PAD, PAD + mark.height / 2), DOMAIN,
              font=f_dom, fill=MUTED, anchor="rm")

    # ---- bloque de texto, anclado por abajo para que crezca hacia arriba
    maxw = W - PAD * 2
    head = wrap(draw, HEADLINE, f_head, maxw)
    sub = wrap(draw, SUB, f_sub, maxw)
    lh_head, lh_sub, gap = 78, 38, 26

    # el bloque no se pega al pie: deja respirar la franja de marca
    bottom = H - PAD - BAR - 34
    y = bottom - len(sub) * lh_sub - gap - len(head) * lh_head
    for line in head:
        draw.text((PAD, y), line, font=f_head, fill=TEXT)
        y += lh_head
    y += gap
    for line in sub:
        draw.text((PAD, y), line, font=f_sub, fill=MUTED)
        y += lh_sub

    # ---- franja de marca al pie
    img.paste(gradient(rgb(GRAD[0]), rgb(GRAD[1]), W).resize((W, BAR)), (0, H - BAR))

    out = ROOT / "og-image.png"
    img.save(out, format="PNG", optimize=True)
    print(f"   og-image.png  {W}x{H}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
