"""Re-encode downloaded Poly Haven JPGs to WebP (smaller downloads).
Usage: python3 scripts/compress_textures.py   (requires Pillow)
"""
import pathlib
from PIL import Image

root = pathlib.Path('public/textures')
total_in = total_out = 0
for jpg in sorted(root.rglob('*.jpg')):
    q = 72 if jpg.parent.name == '2k' else 80
    if jpg.stem == 'nor':
        q += 6  # normals show compression artefacts sooner
    out = jpg.with_suffix('.webp')
    im = Image.open(jpg).convert('RGB')
    im.save(out, 'WEBP', quality=q, method=6)
    total_in += jpg.stat().st_size
    total_out += out.stat().st_size
    jpg.unlink()
    print(f'{out}  {out.stat().st_size // 1024} KB')
print(f'total {total_in / 1e6:.1f} MB -> {total_out / 1e6:.1f} MB')
