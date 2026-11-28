#!/usr/bin/env python3
"""Enmarca las capturas de teléfono de la ficha de Google Play (1080x1920).

    pip install pillow
    python3 tools/gen_play_screens.py [carpeta_de_salida]

Lee las capturas crudas del emulador de imhomi_mobile/store/play/capturas/crudas/
(1080x2400, una por paso del recorrido) y deja cada una enmarcada en
imhomi_mobile/store/play/capturas/, con el mismo nombre. Cómo se sacan las
crudas y de dónde salen sus datos está en capturas/FUENTES.md.

Cada lámina: fondo de marca con el halo del gradiente, arriba un título corto
(Space Grotesk Bold, blanco, dos líneas como máximo) y debajo la captura con
esquinas redondeadas y sombra suave. Play pide de 2 a 8 capturas, lado entre
320 y 3840 px y el largo no más del doble del ancho: 1080x1920 es 9:16. PNG de
24 bits, sin alfa. Paleta y tipografía salen de gen_icons.py y gen_og.py, no se
redefinen acá.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from gen_icons import GRAD, GROUND, gradient, rgb
from gen_og import BOLD, TEXT, radial, wrap

HERE = Path(__file__).resolve().parent
CAPTURAS = HERE.parent.parent / "imhomi_mobile" / "store" / "play" / "capturas"
CRUDAS = CAPTURAS / "crudas"

W, H = 1080, 1920
PAD = 72                     # margen lateral del título
BAR = 8                      # franja de marca al pie, como en og-image y la destacada

TITLE_SIZE = 70
TITLE_LH = 84                # interlineado del título
TITLE_TOP = 96
TITLE_MAXW = W - PAD * 2
MAX_LINES = 2

SHOT_TOP = 340               # dónde empieza la captura, haya una o dos líneas
SHOT_BOTTOM = 58             # aire entre la captura y la franja del pie
NAV_BAR = 64                 # la barra de gestos de Android al pie de la cruda
RADIUS = 44                  # esquinas de la captura, ya a su tamaño final

# El orden es el de la ficha (ficha.md): buscar, ver, hablar, visitar, firmar,
# convivir y enterarse. Voseo, sin artículos de más, un beneficio concreto.
# Cortados a mano con \n, como en gen_play_feature.py: el wrap automático
# dejaba una palabra sola en la segunda línea.
TITULOS = {
    "01-buscar.png": "Buscá por zona,\ntipo y mascotas",
    "02-resultados.png": "Anuncios verificados\nen el lugar",
    "03-detalle.png": "Mirá fotos, precio\ny qué incluye",
    "04-chat.png": "Chateá sin dar\ntu número",
    "05-visita.png": "Visitá con día\ny hora confirmados",
    "06-contrato.png": "Renta, depósito\ny fechas por escrito",
    "07-recibos.png": "Dividí los recibos\ncon tu roomie",
    "08-avisos.png": "Enterate de cada\nvisita y alerta",
}


def rounded_mask(size, radius):
    """Máscara de rectángulo redondeado con borde suave (dibujada al doble)."""
    w, h = size
    big = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius * 2, fill=255)
    return big.resize(size, Image.LANCZOS)


def ground():
    """Fondo de marca: GROUND con el halo del gradiente detrás del teléfono."""
    img = Image.new("RGB", (W, H), rgb(GROUND))
    # halo grande y suave, centrado un poco por debajo de la mitad
    gw, gh = 1500, 1500
    halo = Image.new("RGB", (gw, gh), rgb(GRAD[1]))
    img.paste(halo, ((W - gw) // 2 + 240, H - gh + 520),
              radial((gw, gh)).point(lambda p: int(p * 0.34)))
    # un segundo brillo, más claro, arriba a la izquierda detrás del título
    gw2 = 900
    halo2 = Image.new("RGB", (gw2, gw2), rgb(GRAD[0]))
    img.paste(halo2, (-gw2 // 2 + 60, -gw2 // 2 + 80),
              radial((gw2, gw2), falloff=2.6).point(lambda p: int(p * 0.16)))
    return img


def title_lines(draw, text, font):
    """Las líneas del título: los cortes a mano si los hay, si no el wrap."""
    lines = text.split("\n") if "\n" in text else wrap(draw, text, font, TITLE_MAXW)
    if len(lines) > MAX_LINES:
        raise SystemExit(f"El título «{text}» ocupa {len(lines)} líneas: acortalo a {MAX_LINES}.")
    for line in lines:
        if draw.textlength(line, font=font) > TITLE_MAXW:
            raise SystemExit(f"La línea «{line}» no entra en {TITLE_MAXW} px: cortala distinto.")
    return lines


def frame(raw_path, title, out_path):
    img = ground()
    draw = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(str(BOLD), TITLE_SIZE)

    # ---- título, centrado
    lines = title_lines(draw, title, f_title)
    block = len(lines) * TITLE_LH
    y = TITLE_TOP + (MAX_LINES * TITLE_LH - block) // 2
    for line in lines:
        draw.text((W / 2, y), line, font=f_title, fill=TEXT, anchor="ma")
        y += TITLE_LH

    # ---- captura: sin la barra de gestos, escalada al alto disponible
    shot = Image.open(raw_path).convert("RGB")
    if shot.height > 2000:
        shot = shot.crop((0, 0, shot.width, shot.height - NAV_BAR))
    avail_h = H - BAR - SHOT_BOTTOM - SHOT_TOP
    scale = avail_h / shot.height
    size = (round(shot.width * scale), avail_h)
    shot = shot.resize(size, Image.LANCZOS)
    x0 = (W - size[0]) // 2
    y0 = SHOT_TOP
    mask = rounded_mask(size, RADIUS)

    # ---- sombra suave, corrida hacia abajo
    blur = 46
    sh = Image.new("L", (W, H), 0)
    sh.paste(mask.point(lambda p: int(p * 0.62)), (x0, y0 + 26))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    img.paste(Image.new("RGB", (W, H), (2, 10, 12)), (0, 0), sh)

    # ---- la captura y un filo claro, para que la UI oscura no se funda con el fondo
    img.paste(shot, (x0, y0), mask)
    edge = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (x0, y0, x0 + size[0] - 1, y0 + size[1] - 1), RADIUS,
        outline=(*rgb(GRAD[0]), 70), width=2)
    img = Image.alpha_composite(img.convert("RGBA"), edge).convert("RGB")

    # ---- franja de marca al pie
    img.paste(gradient(rgb(GRAD[0]), rgb(GRAD[1]), W).resize((W, BAR)), (0, H - BAR))

    img.save(out_path, format="PNG", optimize=True)
    print(f"   {out_path.name}  {W}x{H}  {out_path.stat().st_size // 1024} KB  · {' / '.join(lines)}")


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else CAPTURAS
    out_dir.mkdir(parents=True, exist_ok=True)
    faltan = [n for n in TITULOS if not (CRUDAS / n).exists()]
    if faltan:
        raise SystemExit(f"Faltan capturas crudas en {CRUDAS}: {', '.join(faltan)}")
    for name, title in TITULOS.items():
        frame(CRUDAS / name, title, out_dir / name)


if __name__ == "__main__":
    main()
