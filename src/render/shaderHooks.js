// Chainable onBeforeCompile hooks.
//
// three.js materials only have a single `onBeforeCompile` slot and CSM.setupMaterial()
// overwrites it. Every system that patches built-in materials must go through
// addShaderHook() so hooks compose in a stable order and the program cache key
// reflects every patch.

const HOOKS = Symbol('shaderHooks');

/**
 * @param {import('three').Material} material
 * @param {string} key   unique, stable id for this hook (part of program cache key)
 * @param {(shader: object, renderer: object) => void} fn
 */
export function addShaderHook(material, key, fn) {
  let hooks = material[HOOKS];
  if (!hooks) {
    hooks = material[HOOKS] = [];
    // Preserve a pre-existing onBeforeCompile (e.g. set by CSM before us).
    const prev = material.onBeforeCompile;
    if (prev && prev !== Object.getPrototypeOf(material).onBeforeCompile) {
      hooks.push({ key: 'legacy', fn: prev.bind(material) });
    }
    material.onBeforeCompile = function (shader, renderer) {
      for (const h of this[HOOKS]) h.fn(shader, renderer);
    };
    const prevKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = function () {
      return prevKey() + '|' + this[HOOKS].map((h) => h.key).join(',');
    };
  }
  const existing = hooks.findIndex((h) => h.key === key);
  if (existing >= 0) hooks[existing] = { key, fn };
  else hooks.push({ key, fn });
  material.needsUpdate = true;
  return material;
}

/** Wraps a third-party onBeforeCompile (like CSM's) into our hook chain. */
export function adoptOnBeforeCompile(material, key) {
  const fn = material.onBeforeCompile;
  if (material[HOOKS]) {
    // CSM replaced our dispatcher; re-install it with CSM's fn first.
    const hooks = material[HOOKS];
    delete material[HOOKS];
    material.onBeforeCompile = Object.getPrototypeOf(material).onBeforeCompile;
    addShaderHook(material, key, fn);
    for (const h of hooks) if (h.key !== key) addShaderHook(material, h.key, h.fn);
  } else {
    addShaderHook(material, key, fn);
  }
  return material;
}

export function hasShaderHook(material, key) {
  return !!material[HOOKS]?.some((h) => h.key === key);
}

/** Replace `#include <chunk>` (or any marker) keeping the original include. */
export function injectAfter(src, marker, code) {
  if (!src.includes(marker)) {
    throw new Error(`shaderHooks: marker not found: ${marker}`);
  }
  return src.replace(marker, `${marker}\n${code}`);
}

export function injectBefore(src, marker, code) {
  if (!src.includes(marker)) {
    throw new Error(`shaderHooks: marker not found: ${marker}`);
  }
  return src.replace(marker, `${code}\n${marker}`);
}
