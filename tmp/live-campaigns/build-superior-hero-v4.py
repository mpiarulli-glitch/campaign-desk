from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


SOURCE = Path(
    "/Users/meg/Desktop/Email Cowork/clients/Superior Patios/assets/"
    "superior-patios-2026-07-6-free-lights-hero-sharp-v3.png"
)
OUTPUT = Path(
    "/Users/meg/Desktop/Email Cowork/clients/Superior Patios/assets/"
    "superior-patios-2026-07-6-free-lights-hero-sharp-v4.png"
)

source = Image.open(SOURCE).convert("RGB")
width, height = source.size

# Bring the patio closer to the copy without crowding the final word.
photo = source.crop((720, 0, width, height))
photo = photo.resize((width - 650, height), Image.Resampling.LANCZOS)
photo_layer = source.copy()
photo_layer.paste(photo, (650, 0))

# Blend only the transition band, preserving all text on the source panel.
mask = Image.new("L", (width, height), 0)
fade = ImageDraw.Draw(mask)
for x in range(650, 711):
    alpha = round(255 * (x - 650) / 60)
    fade.line((x, 0, x, height), fill=alpha)
fade.rectangle((711, 0, width, height), fill=255)
composite = Image.composite(photo_layer, source, mask)

# Sharpen before and after the 4x-email-width export to protect text edges.
composite = composite.filter(ImageFilter.UnsharpMask(radius=1.1, percent=125, threshold=3))
composite = composite.resize((2400, 1720), Image.Resampling.LANCZOS)
composite = composite.filter(ImageFilter.UnsharpMask(radius=1.4, percent=115, threshold=2))

composite.save(OUTPUT, format="PNG", optimize=True)
print(OUTPUT)
