from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SOURCE = Path(
    "/Users/meg/Desktop/Email Cowork/clients/Superior Patios/assets/"
    "superior-patios-2026-07-6-free-lights-hero-sharp-v2.png"
)
OUTPUT = Path(
    "/Users/meg/Desktop/Email Cowork/clients/Superior Patios/assets/"
    "superior-patios-2026-07-6-free-lights-hero-sharp-v3.png"
)
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

width = 1200
old_height = 800
new_height = 860
panel_edge = 720

source = Image.open(SOURCE).convert("RGB")
canvas = Image.new("RGB", (width, new_height), "#080808")
canvas.paste(source, (0, 0))

# Extend the patio floor naturally beneath the original crop.
floor = source.crop((panel_edge, 740, width, old_height))
floor = floor.resize((width - panel_edge, new_height - 740), Image.Resampling.LANCZOS)
canvas.paste(floor, (panel_edge, 740))

# Restore the black offer panel over the extended canvas and clear the clipped row.
draw = ImageDraw.Draw(canvas)
draw.rectangle((0, 752, panel_edge, new_height), fill="#080808")

gold = "#d7b36c"
white = "#ffffff"

# Phone icon.
draw.ellipse((58, 769, 94, 805), outline=gold, width=5)
draw.arc((68, 776, 86, 798), 105, 250, fill=gold, width=4)
draw.line((70, 781, 67, 786), fill=gold, width=4)
draw.line((82, 795, 86, 791), fill=gold, width=4)

# Contact number, placed with generous bottom clearance.
phone_font = ImageFont.truetype(FONT, 47)
draw.text((112, 763), "(951) 805-0285", font=phone_font, fill=white)

canvas.save(OUTPUT, format="PNG", optimize=True)
print(OUTPUT)
