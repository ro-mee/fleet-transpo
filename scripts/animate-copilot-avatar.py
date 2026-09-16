"""Create and verify a three-second eye-only pulse from the Copilot PNG."""
from pathlib import Path
import math
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "public/images/copilot-avatar.png").convert("RGBA")
rgba = np.asarray(source)
rgb = rgba[:, :, :3]
height, width = rgb.shape[:2]
y, x = np.mgrid[:height, :width]
# Face bounds exclude the equally green cap and headset, based on the source image.
face = (x > width * .40) & (x < width * .88) & (y > height * .47) & (y < height * .66)
r, g, b = rgb.astype(float).transpose(2, 0, 1)
green = g - np.maximum(r, b)
seeds = face & (g > 170) & (green > 15) & (rgba[:, :, 3] > 128)
spread = np.asarray(Image.fromarray((seeds * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(8))) / 255
mask = face * np.clip(green / 35, 0, 1) * np.clip(spread * 4, 0, 1)
mask[mask < .01] = 0
animated = mask > 0
assert seeds.sum() > 100 and animated[:, :int(width * .4)].sum() == 0

blink = '--blink' in sys.argv
eye_layers = []
if blink:
    # Remove the luminous eye layer, then squash it vertically into a closed lid.
    seeds &= ((x < width*.65) & (y > height*.50) & (y < height*.63)) | ((x > width*.71) & (x < width*.855) & (y > height*.49) & (y < height*.60))
    animated = np.zeros_like(animated)
    erase = np.asarray(Image.fromarray((seeds * 255).astype('uint8')).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(5))) / 255
    for side in [x < width * .67, x >= width * .67]:
        yy, xx = np.where(seeds & side)
        x0, x1 = max(0, xx.min()-24), min(width, xx.max()+25)
        y0, y1 = max(0, yy.min()-24), min(height, yy.max()+25)
        original = rgb[y0:y1, x0:x1].astype(float)
        fraction = np.linspace(0, 1, y1-y0)[:, None, None]
        background = original[:1] * (1-fraction) + original[-1:] * fraction
        alpha = np.maximum(mask, erase)[y0:y1, x0:x1, None]
        clean = original * (1-alpha) + background * alpha
        eye_layers.append((x0, x1, y0, y1, clean, original-clean))
        animated[y0:y1, x0:x1] = True

# One fixed palette prevents color flicker in the static body/background.
base_palette = source.convert('RGB').quantize(colors=191).getpalette()[:191 * 3]
eye_samples = np.concatenate([
    np.round(rgb[animated] * level).astype('uint8')
    for level in np.linspace(.22, 1, 12)
], axis=0)
eye_palette = Image.fromarray(eye_samples.reshape(-1, 1, 3)).quantize(colors=64).getpalette()[:64 * 3]
palette = Image.new('P', (1, 1))
palette.putpalette(base_palette + eye_palette + base_palette[:3])
transparent = rgba[:, :, 3] < 128

def indexed(pixels):
    data = np.asarray(Image.fromarray(pixels).quantize(palette=palette, dither=Image.Dither.NONE)).copy()
    data[data == 255] = 0  # Reserve palette entry 255 exclusively for transparency.
    data[transparent] = 255
    return data

static = indexed(rgb)
frames = []
for frame in range(60):
    brightness = .22 + .78 * (1 + math.cos(2 * math.pi * frame / 60)) / 2
    pixels = np.round(rgb * (1 - mask[:, :, None] * (1 - brightness))).astype('uint8')
    if blink:
        # Open for most of the loop; close in 100 ms, hold 100 ms, reopen in 150 ms.
        openness = np.interp(frame * 50, [0, 1200, 1300, 1400, 1550, 3000], [1, 1, .04, .04, 1, 1])
        pixels = rgb.copy()
        if openness < 1:
            for x0, x1, y0, y1, clean, light in eye_layers:
                h = max(2, round((y1-y0) * openness))
                squeezed = np.stack([np.asarray(Image.fromarray(light[:, :, c].astype('float32')).resize((x1-x0, h), Image.Resampling.BICUBIC)) for c in range(3)], axis=2)
                patch = clean.copy()
                top = (y1-y0-h)//2
                patch[top:top+h] += squeezed
                pixels[y0:y1, x0:x1] = np.clip(np.round(patch), 0, 255).astype('uint8')
    data = static.copy()
    dynamic = indexed(pixels)
    data[animated] = dynamic[animated]
    image = Image.fromarray(data).convert('P')
    image.putpalette(palette.getpalette())
    frames.append(image)

output = ROOT / ("public/images/copilot-avatar-blinking.gif" if blink else "public/images/copilot-avatar-pulse.gif")
frames[0].save(output, save_all=True, append_images=frames[1:], duration=50,
               loop=0, transparency=255, disposal=1, optimize=False)

with Image.open(output) as result:
    assert result.info['loop'] == 0
    first = np.asarray(result.convert('RGBA')).copy()
    elapsed = 0
    changed = False
    for frame in range(result.n_frames):
        result.seek(frame)
        elapsed += result.info['duration']
        decoded = np.asarray(result.convert('RGBA'))
        assert np.array_equal(decoded[~animated], first[~animated]), 'Static pixels changed'
        changed |= not np.array_equal(decoded[animated], first[animated])
    assert elapsed == 3000 and changed
    print(f"Verified {result.n_frames} frames, {elapsed} ms, infinite loop; all non-eye pixels static.")
    print(f"Saved {output} ({output.stat().st_size:,} bytes)")
