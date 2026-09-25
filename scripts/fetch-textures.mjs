// Downloads the CC0 Poly Haven textures used by the game into public/textures.
// Usage: node scripts/fetch-textures.mjs [--res 1k,2k]
//        python3 scripts/compress_textures.py   (re-encode to WebP, ~6x smaller)
// All assets: https://polyhaven.com (CC0 1.0 Universal).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// res: resolutions shipped; maps: Poly Haven map keys → file names
const FULL = { res: ['1k', '2k'], maps: { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' } };
const LIGHT = { res: ['1k'], maps: { Diffuse: 'diff', nor_gl: 'nor' } };
const ASSETS = {
  rock_face: { use: 'Canyon cliff walls, mountain and glacier rock', ...FULL },
  worn_rock_natural_01: { use: 'Sandstone strata / rims', ...FULL },
  gravelly_sand: { use: 'Canyon floor, desert, river banks', ...FULL },
  aerial_grass_rock: { use: 'Emerald valley meadows and slopes', ...LIGHT },
  snow_field_aerial: { use: 'Snow fields above the snow line (emerald / glacier)', ...LIGHT },
  aerial_sand: { use: 'Golden dunes', ...LIGHT }
};
const resArg = process.argv.indexOf('--res');
const RES = resArg > 0 ? process.argv[resArg + 1].split(',') : ['1k', '2k'];
const OUT = path.resolve('public/textures');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const credits = ['# Texture credits', '', 'All textures are CC0 from [Poly Haven](https://polyhaven.com).', ''];
for (const [id, asset] of Object.entries(ASSETS)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  credits.push(`- **${info.name}** (\`${id}\`) — ${asset.use}. Authors: ${Object.keys(info.authors || {}).join(', ')}. https://polyhaven.com/a/${id}`);
  for (const res of asset.res) {
    if (!RES.includes(res)) continue;
    const dir = path.join(OUT, id, res);
    await mkdir(dir, { recursive: true });
    for (const [key, short] of Object.entries(asset.maps)) {
      const f = files[key]?.[res]?.jpg;
      if (!f) throw new Error(`missing ${id} ${key} ${res}`);
      const dest = path.join(dir, `${short}.jpg`);
      if ((await exists(dest)) || (await exists(dest.replace(/\.jpg$/, '.webp')))) continue;
      const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      const md5 = createHash('md5').update(buf).digest('hex');
      if (f.md5 && md5 !== f.md5) throw new Error(`md5 mismatch ${f.url}`);
      await writeFile(dest, buf);
      console.log('saved', dest, (buf.length / 1024).toFixed(0) + ' KB');
    }
  }
}
await writeFile(path.join(OUT, 'CREDITS.md'), credits.join('\n') + '\n');
console.log('done');
