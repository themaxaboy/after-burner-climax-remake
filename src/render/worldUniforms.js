import { Color, Vector3 } from 'three';
import { addShaderHook } from './shaderHooks.js';

// Uniform objects shared by reference across every world material, so a single
// write per frame updates all shaders (no per-material uniform upload loops).
export const WorldUniforms = {
  uSunDir: { value: new Vector3(0, 0.2, -1).normalize() },
  uSunColor: { value: new Color(1, 0.9, 0.8) },
  uFogColor: { value: new Color(0.5, 0.6, 0.7) }, // in-scatter away from the sun
  uFogSunColor: { value: new Color(1.0, 0.8, 0.6) }, // in-scatter toward the sun
  uFogDensity: { value: 0.00012 },
  uFogHeightFalloff: { value: 0.0016 },
  uFogBaseHeight: { value: 0 },
  uFogMax: { value: 1.0 },
  uTime: { value: 0 }, // world time (slows during Climax)
  uRealTime: { value: 0 }
};

// Analytic exponential height fog with sun-directional in-scattering
// (aerial perspective). Works in linear HDR before tone mapping.
export const WORLD_FOG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseHeight;
uniform float uFogMax;

float worldFogAmount(vec3 ro, vec3 wp, out vec3 rd) {
  vec3 d = wp - ro;
  float dist = length(d);
  rd = d / max(dist, 1e-4);
  float b = uFogHeightFalloff;
  float h0 = max(ro.y - uFogBaseHeight, -50.0);
  float k = rd.y * b;
  float t = abs(k) < 1e-5 ? dist : (1.0 - exp(-dist * k)) / k;
  float optical = uFogDensity * exp(-h0 * b) * t;
  return min(1.0 - exp(-optical), uFogMax);
}

vec3 worldFogColor(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  float sunAmt = pow(s, 6.0) * 0.85 + pow(s, 64.0) * 0.6;
  return mix(uFogColor, uFogSunColor, clamp(sunAmt, 0.0, 1.0));
}

vec3 applyWorldFog(vec3 col, vec3 wp) {
  vec3 rd;
  float f = worldFogAmount(cameraPosition, wp, rd);
  return mix(col, worldFogColor(rd), f);
}
`;

/**
 * Patch a built-in lit material (Standard/Physical/Lambert/Basic) to use our
 * world fog instead of three's scene fog. Safe with InstancedMesh.
 */
export function applyWorldFog(material) {
  material.fog = false;
  return addShaderHook(material, 'worldFog', (shader) => {
    shader.uniforms.uSunDir = WorldUniforms.uSunDir;
    shader.uniforms.uSunColor = WorldUniforms.uSunColor;
    shader.uniforms.uFogColor = WorldUniforms.uFogColor;
    shader.uniforms.uFogSunColor = WorldUniforms.uFogSunColor;
    shader.uniforms.uFogDensity = WorldUniforms.uFogDensity;
    shader.uniforms.uFogHeightFalloff = WorldUniforms.uFogHeightFalloff;
    shader.uniforms.uFogBaseHeight = WorldUniforms.uFogBaseHeight;
    shader.uniforms.uFogMax = WorldUniforms.uFogMax;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorldPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 fwp = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            fwp = batchingMatrix * fwp;
          #endif
          #ifdef USE_INSTANCING
            fwp = instanceMatrix * fwp;
          #endif
          vFogWorldPos = (modelMatrix * fwp).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorldPos;\n' + WORLD_FOG_PARS)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyWorldFog(gl_FragColor.rgb, vFogWorldPos);');
  });
}
