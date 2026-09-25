import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter,
  LinearMipmapLinearFilter, Mesh, PlaneGeometry, ShaderMaterial, DataTexture, RGBAFormat
} from 'three';
import { WorldUniforms, WORLD_FOG_PARS } from '../render/worldUniforms.js';
import { Rng } from '../core/rng.js';
import { makeFrame } from '../sim/rail.js';

let ATLAS = 1024; // 2x2 variants
const _f = makeFrame();

/**
 * Bake cumulus puff sprites: density in alpha, a pseudo-normal (from the
 * blurred density gradient) in RGB so puffs can be lit by the sun at runtime.
 */
function bakeAtlas(seed = 5, atlasSize = 1024) {
  ATLAS = atlasSize;
  const rng = new Rng(seed);
  const size = ATLAS, half = size / 2;
  const dens = new Float32Array(size * size);
  // tileable-enough value noise lattice
  const G = 64;
  const lat = new Float32Array(G * G);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = lat[((yi & 63) * G) + (xi & 63)], b = lat[((yi & 63) * G) + ((xi + 1) & 63)];
    const c = lat[(((yi + 1) & 63) * G) + (xi & 63)], d = lat[(((yi + 1) & 63) * G) + ((xi + 1) & 63)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) {
      sum += amp * vnoise(x * f, y * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * half, oy = Math.floor(v / 2) * half;
    const offX = rng.range(0, 60), offY = rng.range(0, 60);
    // a few large lobes define the cumulus silhouette
    const lobes = [];
    const nl = 5 + v;
    for (let k = 0; k < nl; k++) {
      const a = rng.range(Math.PI * 0.95, Math.PI * 2.05);
      const r = rng.range(0.0, 0.22);
      lobes.push([0.5 + Math.cos(a) * r, 0.58 + Math.sin(a) * r * 0.8, rng.range(0.17, 0.28)]);
    }
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const px = x / half, py = y / half;
        let shape = 0;
        for (const [cx, cy, rr] of lobes) {
          const dx = (px - cx) / rr, dy = (py - cy) / (rr * 0.9);
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) shape = Math.max(shape, (1 - d2) * (1 - d2));
        }
        // flatter base
        if (py > 0.66) shape *= Math.max(0, 1 - (py - 0.66) * 5.5);
        const n = fbm(px * 7 + offX, py * 7 + offY);
        let d = shape * 1.35 - (1 - n) * 0.75;
        d = Math.max(0, d);
        dens[(oy + y) * size + ox + x] = Math.min(1, d * 1.6);
      }
    }
  }
  // blur for normals (box blur 2 passes)
  const blur = new Float32Array(size * size);
  const tmp = new Float32Array(size * size);
  const R = 6;
  const pass = (src, dst, dx, dy) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let acc = 0;
        for (let k = -R; k <= R; k += 2) {
          const sx = dx ? Math.min(size - 1, Math.max(0, x + k)) : x;
          const sy = dy ? Math.min(size - 1, Math.max(0, y + k)) : y;
          acc += src[sy * size + sx];
        }
        dst[y * size + x] = acc / (R + 1);
      }
    }
  };
  pass(dens, tmp, 1, 0);
  pass(tmp, blur, 0, 1);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = blur[y * size + Math.max(0, x - 2)], r = blur[y * size + Math.min(size - 1, x + 2)];
      const u = blur[Math.max(0, y - 2) * size + x], d = blur[Math.min(size - 1, y + 2) * size + x];
      let nx = (l - r) * 4.0, ny = (d - u) * 4.0; // texture row 0 = top (flipY false) → +y up
      let nz = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny))) * 0.8 + 0.2;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      data[i * 4] = (nx * 0.5 + 0.5) * 255;
      data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      const a = Math.min(1, dens[i] * 1.1);
      data[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const vertex = /* glsl */ `
attribute vec4 aPuff;   // xyz world pos, w size
attribute vec4 aData;   // x variant, y rotation, z shade (base darkening), w opacity
uniform float uNearFade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying float vShade;
varying float vAlpha;
void main() {
  vec3 center = aPuff.xyz;
  float size = aPuff.w;
  vec3 toCam = normalize(cameraPosition - center);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 right = normalize(cross(camUp, toCam));
  vec3 up = cross(toCam, right);
  float c = cos(aData.y), s = sin(aData.y);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 wp = center + (right * p.x + up * p.y) * size;
  vRight = right * c + up * s;
  vUp = -right * s + up * c;
  vToCam = toCam;
  vWorld = wp;
  float v = aData.x;
  vec2 cell = vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
  vUv = cell + (uv * 0.98 + 0.01) * 0.5;
  vShade = aData.z;
  float dist = length(cameraPosition - center);
  vAlpha = aData.w * smoothstep(uNearFade * 0.4, uNearFade + size * 0.6, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const fragment = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform float uSunI;
uniform float uDensity;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying float vShade;
varying float vAlpha;
${WORLD_FOG_PARS}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vAlpha * uDensity;
  if (a < 0.01) discard;
  vec3 n = t.xyz * 2.0 - 1.0;
  vec3 N = normalize(vRight * n.x + vUp * n.y + vToCam * max(n.z, 0.15));
  float ndl = dot(N, uSunDir);
  float wrap = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  vec3 vd = normalize(vWorld - cameraPosition);
  float mu = dot(vd, uSunDir);
  // Henyey-Greenstein forward scattering → silver lining toward the sun
  float g = 0.55;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
  float thin = 1.0 - t.a;
  vec3 sun = uSunColor * uSunI;
  vec3 amb = mix(uAmbientBottom, uAmbientTop, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = amb * (0.85 + 0.35 * vShade) + sun * (wrap * wrap * 0.42 * vShade + hg * (0.35 + thin * 2.0));
  col = applyWorldFog(col, vWorld);
  gl_FragColor = vec4(col * a, a);
}`;

/**
 * Cumulus cloud banks made of lit, camera-facing puffs (instanced, one draw
 * call), recycled along the stage rail. Flying through a puff whites out the
 * screen (reported via `whiteout`).
 */
export class Clouds {
  constructor({ rail, count = 240, seed = 3, minY = 350, maxY = 1400, spread = 2600, ahead = 9000, behind = 800, puffSize = [70, 180], layer = null, atlasSize = 1024 }) {
    this.rail = rail;
    this.rng = new Rng(seed);
    this.minY = minY;
    this.maxY = maxY;
    this.spread = spread;
    this.ahead = ahead;
    this.behind = behind;
    this.puffSize = puffSize;
    this.layer = layer; // {y, thickness} for a cloud deck
    this.atlas = bakeAtlas(seed, atlasSize);
    const perCluster = 10;
    this.clusterCount = Math.max(4, Math.floor(count / perCluster));
    this.perCluster = perCluster;
    const n = this.clusterCount * perCluster;
    this.n = n;
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.puff = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.data = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.puff.setUsage(DynamicDrawUsage);
    this.data.setUsage(DynamicDrawUsage);
    geo.setAttribute('aPuff', this.puff);
    geo.setAttribute('aData', this.data);
    geo.instanceCount = n;
    this.geometry = geo;
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: {
        uAtlas: { value: this.atlas },
        uAmbientTop: { value: new Color(0.5, 0.6, 0.75) },
        uAmbientBottom: { value: new Color(0.3, 0.32, 0.36) },
        uSunI: { value: 3 },
        uDensity: { value: 1 },
        uNearFade: { value: 80 },
        uSunDir: WorldUniforms.uSunDir,
        uSunColor: WorldUniforms.uSunColor,
        uFogColor: WorldUniforms.uFogColor,
        uFogSunColor: WorldUniforms.uFogSunColor,
        uFogDensity: WorldUniforms.uFogDensity,
        uFogHeightFalloff: WorldUniforms.uFogHeightFalloff,
        uFogBaseHeight: WorldUniforms.uFogBaseHeight,
        uFogMax: WorldUniforms.uFogMax
      }
    });
    // premultiplied "over"
    this.material.blending = 5; // CustomBlending
    this.material.blendSrc = 201; // OneFactor
    this.material.blendDst = 205; // OneMinusSrcAlphaFactor
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'clouds';
    this.clusters = [];
    this.order = new Uint16Array(n);
    this.dist = new Float32Array(n);
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.info = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.whiteout = 0;
    this._frame = 0;
  }

  setLighting(sunIntensity, ambientTop, ambientBottom) {
    this.material.uniforms.uSunI.value = sunIntensity;
    if (ambientTop) this.material.uniforms.uAmbientTop.value.copy(ambientTop);
    if (ambientBottom) this.material.uniforms.uAmbientBottom.value.copy(ambientBottom);
  }

  /** Place all clusters starting from rail distance s0. */
  init(s0) {
    const step = (this.ahead + this.behind) / this.clusterCount;
    for (let c = 0; c < this.clusterCount; c++) {
      this._placeCluster(c, s0 - this.behind + step * (c + this.rng.next()));
    }
    this._writeAll();
  }

  _placeCluster(c, s) {
    const rng = this.rng;
    this.rail.frameAt(Math.min(s, this.rail.length), _f);
    let lateral = rng.range(-this.spread, this.spread);
    // keep the immediate corridor mostly clear, but sometimes put a bank right on the path
    if (Math.abs(lateral) < 250 && rng.next() < 0.6) lateral += Math.sign(lateral || 1) * 400;
    const deck = this.layer;
    const cy = deck ? deck.y + rng.range(-deck.thickness * 0.3, deck.thickness * 0.5) : rng.range(this.minY, this.maxY);
    const cx = _f.pos.x + _f.R.x * lateral;
    const cz = _f.pos.z + _f.R.z * lateral;
    const scale = rng.range(0.7, 1.5) * (deck ? 1.6 : 1);
    const cl = (this.clusters[c] = { s, x: cx, y: cy, z: cz, r: 420 * scale });
    for (let k = 0; k < this.perCluster; k++) {
      const i = c * this.perCluster + k;
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * 320 * scale;
      const up = rng.next();
      const size = rng.range(this.puffSize[0], this.puffSize[1]) * scale * (1.2 - up * 0.4);
      this.pos[i * 3] = cx + Math.cos(a) * rr * 1.3;
      this.pos[i * 3 + 1] = cy + up * 260 * scale * (deck ? 0.3 : 1);
      this.pos[i * 3 + 2] = cz + Math.sin(a) * rr;
      this.size[i] = size;
      this.info[i * 4] = rng.int(0, 3);
      this.info[i * 4 + 1] = rng.range(-0.3, 0.3);
      this.info[i * 4 + 2] = 0.55 + up * 0.45; // tops brighter than bases
      this.info[i * 4 + 3] = rng.range(0.75, 1);
    }
    return cl;
  }

  _writeAll() {
    const P = this.puff.array, D = this.data.array;
    for (let j = 0; j < this.n; j++) {
      const i = this.order[j];
      P[j * 4] = this.pos[i * 3];
      P[j * 4 + 1] = this.pos[i * 3 + 1];
      P[j * 4 + 2] = this.pos[i * 3 + 2];
      P[j * 4 + 3] = this.size[i];
      D[j * 4] = this.info[i * 4];
      D[j * 4 + 1] = this.info[i * 4 + 1];
      D[j * 4 + 2] = this.info[i * 4 + 2];
      D[j * 4 + 3] = this.info[i * 4 + 3];
    }
    this.puff.needsUpdate = true;
    this.data.needsUpdate = true;
  }

  /**
   * @param {number} playerS rail distance of the player
   * @param {Camera} camera
   */
  update(dt, camera, playerS) {
    for (let c = 0; c < this.clusterCount; c++) {
      if (this.clusters[c].s < playerS - this.behind) {
        // recycle to the far end
        let maxS = -Infinity;
        for (const k of this.clusters) maxS = Math.max(maxS, k.s);
        this._placeCluster(c, Math.max(maxS, playerS + this.ahead * 0.8) + this.rng.range(200, 900));
      }
    }
    // back-to-front sort (insertion sort; nearly sorted frame to frame)
    const cp = camera.position;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const dx = this.pos[i * 3] - cp.x, dy = this.pos[i * 3 + 1] - cp.y, dz = this.pos[i * 3 + 2] - cp.z;
      this.dist[i] = dx * dx + dy * dy + dz * dz;
    }
    const o = this.order, d = this.dist;
    for (let i = 1; i < n; i++) {
      const v = o[i];
      const dv = d[v];
      let j = i - 1;
      while (j >= 0 && d[o[j]] < dv) {
        o[j + 1] = o[j];
        j--;
      }
      o[j + 1] = v;
    }
    this._writeAll();
    // whiteout when the camera is inside a puff
    let w = 0;
    for (let i = 0; i < n; i++) {
      const r = this.size[i] * 0.42;
      if (this.dist[i] < r * r) w = Math.max(w, 1 - Math.sqrt(this.dist[i]) / r);
    }
    this.whiteout += (Math.min(0.85, w * 1.6) - this.whiteout) * Math.min(1, dt * 8);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}

