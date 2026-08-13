"""Generate Resume Match extension icons: an 'RC' monogram in Georgia Bold
on the app's dark background.

Drawn at 8x and downsampled, which is what keeps the curves clean at 16px --
drawing directly at 16 gives you jagged, uneven strokes.
"""

from PIL import Image, ImageDraw, ImageFont

BG = (26, 26, 25, 255)        # --bg
FG = (240, 239, 236, 255)     # --text-primary-color
FONT = "C:/Windows/Fonts/georgiab.ttf"
SIZES = [16, 32, 48, 128]
SCALE = 8
OUT = "C:/Users/rizig/OneDrive/Desktop/ResumeMatch/icons"


def render(size):
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Smaller icons need proportionally bigger letters and tighter corners.
    # Padding that looks elegant at 128px makes 16px unreadable, so the ratio
    # is graded per size rather than switched at a threshold -- a hard jump
    # is visible when two sizes appear near each other.
    fill_ratio = {16: 0.78, 32: 0.72, 48: 0.66, 128: 0.58}[size]
    radius = 0.18 if size <= 32 else 0.22

    draw.rounded_rectangle(
        [0, 0, big - 1, big - 1],
        radius=int(big * radius),
        fill=BG,
    )

    # Fit the monogram to the tile, then centre it on its actual drawn bounds
    # -- font metrics include ascender space that would otherwise push the
    # letters visibly high.
    target = big * fill_ratio
    pt = int(target)
    while pt > 4:
        font = ImageFont.truetype(FONT, pt)
        box = draw.textbbox((0, 0), "RC", font=font)
        if (box[2] - box[0]) <= target and (box[3] - box[1]) <= target:
            break
        pt -= 1

    box = draw.textbbox((0, 0), "RC", font=font)
    x = (big - (box[2] - box[0])) / 2 - box[0]
    y = (big - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), "RC", font=font, fill=FG)

    return img.resize((size, size), Image.LANCZOS)


for size in SIZES:
    render(size).save(f"{OUT}/icon{size}.png")
    print(f"icon{size}.png")
