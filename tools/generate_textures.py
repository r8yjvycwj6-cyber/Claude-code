#!/usr/bin/env python3
"""Generates every texture of the mod procedurally (no external art needed).

Run from the repo root:  python3 tools/generate_textures.py
Entity skins use the standard biped UV layout on a 64x64 canvas; each entity also gets an
"_eyes" overlay that the client renders full-bright so the eyes glow in the dark.
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src/main/resources/assets/horrorentities/textures"

# UV regions of the standard biped skin (x0, y0, x1, y1), x1/y1 exclusive.
HEAD = (0, 0, 32, 16)
HEAD_FRONT = (8, 8, 16, 16)
BODY = (16, 16, 40, 32)
BODY_FRONT = (20, 20, 28, 32)
ARMS = (40, 16, 56, 36)  # tall enough for 16px thin arms
LEGS = (0, 16, 16, 34)
EYES = [(9, 12, 11, 14), (13, 12, 15, 14)]


def shade(color, amount):
    return tuple(max(0, min(255, c + amount)) for c in color[:3]) + ((color[3],) if len(color) == 4 else ())


def fill(img, box, color, noise=10, rng=None):
    rng = rng or random
    px = img.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = shade(color, rng.randint(-noise, noise))


def rect(img, box, color):
    ImageDraw.Draw(img).rectangle([box[0], box[1], box[2] - 1, box[3] - 1], fill=color)


def new_skin():
    return Image.new("RGBA", (64, 64), (0, 0, 0, 0))


def eyes_layer(boxes, color):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    for box in boxes:
        rect(img, box, color + (255,))
    return img


def stalker(rng):
    img = new_skin()
    suit = (16, 16, 20, 255)
    fill(img, HEAD, (222, 222, 224, 255), 6, rng)
    fill(img, BODY, suit, 5, rng)
    fill(img, ARMS, suit, 5, rng)
    fill(img, LEGS, suit, 5, rng)
    # hollow eye sockets, no mouth: a face that is almost a face
    for box in EYES:
        rect(img, (box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1), (24, 24, 28, 255))
    # white shirt and a thin red tie down the front of the suit
    rect(img, (23, 20, 25, 28), (210, 210, 214, 255))
    rect(img, (24, 21, 25, 29), (120, 10, 14, 255))
    # pale hands
    rect(img, (40, 28, 56, 30), (214, 214, 218, 255))
    return img, eyes_layer(EYES, (235, 240, 255))


def hollow(rng):
    img = new_skin()
    skin = (198, 134, 101, 255)
    fill(img, HEAD, skin, 8, rng)
    fill(img, BODY, (0, 168, 168, 255), 8, rng)
    fill(img, ARMS, (0, 168, 168, 255), 8, rng)
    fill(img, LEGS, (58, 58, 150, 255), 8, rng)
    # hair: top row of the head and the back of it
    fill(img, (8, 0, 16, 8), (70, 44, 24, 255), 8, rng)
    fill(img, (24, 8, 32, 16), (70, 44, 24, 255), 8, rng)
    for x0 in (0, 16):
        fill(img, (x0, 8, x0 + 8, 10), (70, 44, 24, 255), 8, rng)
    fill(img, (8, 8, 16, 10), (70, 44, 24, 255), 8, rng)
    # forearms and shoes
    rect(img, (40, 28, 56, 32), skin)
    rect(img, (0, 30, 16, 34), (90, 90, 90, 255))
    # white, pupil-less eyes
    for box in EYES:
        rect(img, box, (255, 255, 255, 255))
    rect(img, (11, 14, 13, 15), (150, 96, 70, 255))
    return img, eyes_layer(EYES, (255, 255, 255))


def mimic(rng):
    img = new_skin()
    skin = (168, 158, 128, 255)
    robe = (92, 66, 48, 255)
    fill(img, HEAD, skin, 8, rng)
    fill(img, BODY, robe, 9, rng)
    fill(img, ARMS, robe, 9, rng)
    fill(img, LEGS, shade(robe, -22), 9, rng)
    rect(img, (40, 28, 56, 32), skin)
    # a grin that is too wide, and mismatched eyes
    rect(img, (8, 14, 16, 16), (30, 18, 18, 255))
    for x in range(8, 16, 2):
        rect(img, (x, 14, x + 1, 15), (225, 220, 205, 255))
    eyes = [(9, 11, 12, 14), (13, 12, 15, 14)]
    for box in eyes:
        rect(img, (box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1), (30, 22, 16, 255))
        rect(img, box, (235, 215, 140, 255))
    # belt and patched cloth
    rect(img, (20, 28, 28, 29), (50, 36, 26, 255))
    fill(img, (22, 22, 25, 25), shade(robe, 28), 6, rng)
    return img, eyes_layer([(9, 11, 12, 14), (13, 12, 15, 14)], (255, 232, 150))


def gaunt(rng):
    img = new_skin()
    skin = (150, 152, 140, 255)
    fill(img, HEAD, skin, 7, rng)
    fill(img, BODY, skin, 7, rng)
    fill(img, ARMS, shade(skin, -10), 7, rng)
    fill(img, LEGS, shade(skin, -14), 7, rng)
    # ribs on chest and back
    for y in range(21, 31, 2):
        rect(img, (21, y, 27, y + 1), shade(skin, -48))
        rect(img, (33, y, 39, y + 1), shade(skin, -48))
    # joints and bony knuckles
    for y in (23, 29):
        rect(img, (40, y, 56, y + 1), shade(skin, -40))
    rect(img, (0, 24, 16, 25), shade(skin, -40))
    # sunken sockets and a gaping mouth
    for box in EYES:
        rect(img, (box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 2), (14, 14, 12, 255))
    rect(img, (10, 14, 14, 16), (14, 8, 8, 255))
    return img, eyes_layer(EYES, (240, 232, 140))


def shade_entity(rng):
    img = new_skin()
    base = (8, 8, 12, 255)
    for region in (HEAD, BODY, ARMS, LEGS):
        fill(img, region, base, 4, rng)
    slits = [(9, 12, 11, 13), (13, 12, 15, 13)]
    return img, eyes_layer(slits, (255, 255, 255))


ENTITIES = {
    "stalker": stalker,
    "hollow": hollow,
    "mimic": mimic,
    "gaunt": gaunt,
    "shade": shade_entity,
}


def px_art(rows, palette):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in palette:
                px[x, y] = palette[ch]
    return img


def shard():
    rows = [
        "................",
        ".......hh.......",
        "......hhmm......",
        "......hmmmd.....",
        ".....hmmmmdd....",
        ".....hmmmmmd....",
        "....hmmmMmmdd...",
        "....hmmMMmmdd...",
        "....hmmMMmmdd...",
        ".....hmmMmmd....",
        ".....hmmmmdd....",
        "......mmmmd.....",
        "......mmmdd.....",
        ".......mdd......",
        ".......dd.......",
        "................",
    ]
    pal = {
        "h": (186, 150, 230, 255),
        "m": (104, 52, 160, 255),
        "M": (150, 90, 210, 255),
        "d": (40, 16, 72, 255),
    }
    return px_art(rows, pal)


def charm(greater):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gold = (232, 190, 52, 255)
    dark = (140, 100, 20, 255)
    glow = (255, 244, 150, 255)
    core = (120, 40, 190, 255) if greater else (255, 214, 80, 255)
    d.line([(8, 0), (8, 3)], fill=dark)  # chain
    d.ellipse([2, 3, 13, 14], outline=gold, width=2)
    d.arc([2, 3, 13, 14], 200, 340, fill=glow)
    d.ellipse([5, 6, 10, 11], fill=core)
    d.point([(6, 7)], fill=(255, 255, 255, 255))
    d.point([(8, 14), (7, 14)], fill=dark)
    if greater:
        for p in [(1, 8), (14, 8), (8, 2)]:
            d.point([p], fill=(170, 100, 235, 255))
    return img


def icon():
    img = Image.new("RGBA", (128, 128), (10, 10, 14, 255))
    d = ImageDraw.Draw(img)
    rng = random.Random(7)
    for _ in range(900):
        x, y = rng.randint(0, 127), rng.randint(0, 127)
        v = rng.randint(14, 30)
        d.point((x, y), fill=(v, v, v + 4, 255))
    # silhouette and two white eyes
    d.rectangle([48, 30, 80, 62], fill=(4, 4, 6, 255))
    d.rectangle([40, 62, 88, 128], fill=(4, 4, 6, 255))
    d.rectangle([54, 42, 60, 48], fill=(255, 255, 255, 255))
    d.rectangle([68, 42, 74, 48], fill=(255, 255, 255, 255))
    return img


def main():
    (OUT / "entity").mkdir(parents=True, exist_ok=True)
    (OUT / "item").mkdir(parents=True, exist_ok=True)

    for name, fn in ENTITIES.items():
        skin, eyes = fn(random.Random(name))
        skin.save(OUT / "entity" / f"{name}.png")
        eyes.save(OUT / "entity" / f"{name}_eyes.png")

    shard().save(OUT / "item" / "nightmare_shard.png")
    charm(False).save(OUT / "item" / "warding_charm.png")
    charm(True).save(OUT / "item" / "greater_warding_charm.png")
    icon().save(OUT.parent.parent.parent / "icon.png")
    print("textures written to", OUT)


if __name__ == "__main__":
    main()
