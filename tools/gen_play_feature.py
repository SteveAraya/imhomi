#!/usr/bin/env python3
"""Genera la imagen destacada de Google Play (1024x500).

    pip install pillow
    python3 tools/gen_play_feature.py [salida.png]

Por defecto la deja en imhomi_mobile/store/play/, el repo hermano, que es
donde vive todo lo de las tiendas.

Play la muestra arriba de la ficha y la recorta o le superpone el boton de
reproducir si hay video: el texto queda en la mitad izquierda, lejos de los
bordes, y la derecha es solo el halo de marca. PNG de 24 bits, sin alfa.

En la tienda se ve al lado del icono de la app, asi que la casa es la del
icono (store/play-icon-512.png: la de lineas con la senal), no la solida de
la web. Su fondo es GROUND, asi que se apoya sin borde. Paleta y tipografia
salen de gen_icons.py y gen_og.py, no se redefinen aca.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from gen_icons import GRAD, GROUND, gradient, rgb
from gen_og import BOLD, MEDIUM, MUTED, TEXT, radial, wrap

HERE = Path(__file__).resolve().parent
STORE = HERE.parent.parent / "imhomi_mobile" / "store"
ICON = STORE / "play-icon-512.png"
DEFAULT_OUT = STORE / "play" / "feature-graphic-1024x500.png"

W, H = 1024, 500
PAD = 64
BAR = 6

WORDMARK = "ImHomi"
# Cortado a mano: con wrap automatico "app" quedaba sola en la ultima linea.
HEADLINE = ["Todo lo que pasa", "en un alquiler,", "en una sola app"]
SUB = "Buscá, visitá, firmá y convivé. Hecho en Costa Rica."


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    img = Image.new("RGB", (W, H), rgb(GROUND))

    # halo de marca a la derecha, donde Play pone el boton de video
    gw, gh = 820, 820
    halo = Image.new("RGB", (gw, gh), rgb(GRAD[1]))
    img.paste(halo, (W - gw + 300, (H - gh) // 2 + 60),
              radial((gw, gh)).point(lambda p: int(p * 0.32)))

    icon = Image.open(ICON).convert("RGB")

    # la casa del icono, grande y apagada a la derecha, dentro del halo
    big = icon.resize((440, 440), Image.LANCZOS)
    img.paste(big, (W - big.width + 20, (H - big.height) // 2),
              radial(big.size, falloff=0.6).point(lambda p: int(p * 0.55)))

    draw = ImageDraw.Draw(img)
    f_mark = ImageFont.truetype(str(BOLD), 34)
    f_head = ImageFont.truetype(str(BOLD), 50)
    f_sub = ImageFont.truetype(str(MEDIUM), 22)

    # el icono entero como marca: es lo que la gente ve en su pantalla
    mark = icon.crop((56, 56, 456, 456)).resize((60, 60), Image.LANCZOS)
    img.paste(mark, (PAD, PAD))
    draw.text((PAD + mark.width + 18, PAD + mark.height / 2), WORDMARK,
              font=f_mark, fill=TEXT, anchor="lm")

    maxw = 560
    head = HEADLINE
    sub = wrap(draw, SUB, f_sub, maxw)
    lh_head, lh_sub, gap = 60, 32, 20
    bottom = H - PAD - BAR - 10
    y = bottom - len(sub) * lh_sub - gap - len(head) * lh_head
    for line in head:
        draw.text((PAD, y), line, font=f_head, fill=TEXT)
        y += lh_head
    y += gap
    for line in sub:
        draw.text((PAD, y), line, font=f_sub, fill=MUTED)
        y += lh_sub

    img.paste(gradient(rgb(GRAD[0]), rgb(GRAD[1]), W).resize((W, BAR)), (0, H - BAR))

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="PNG", optimize=True)
    print(f"   {out.name}  {W}x{H}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
