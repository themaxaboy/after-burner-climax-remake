import { Menu } from '../menu.js';
import { saveSettings } from '../../core/save.js';
import { setLang, t } from '../i18n.js';
import { PRESET_ORDER, PRESETS } from '../../core/quality.js';

/** t(key) with an English fallback while the key is missing from the string tables. */
const tr = (key, fallback) => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** Options menu: every change applies immediately and persists. */
export function createOptionsMenu(game, onBack) {
  const s = game.settings;
  const save = () => saveSettings(s);
  const vol = () => game.audio?.setVolumes({ master: s.volMaster, sfx: s.volSfx, music: s.volMusic, voice: s.volVoice });
  const items = [
    {
      type: 'select', label: t('opt.quality'),
      options: [{ value: null, label: 'AUTO' }, ...PRESET_ORDER.map((k) => ({ value: k, label: PRESETS[k].label }))],
      get: () => s.quality,
      set: (v) => {
        s.quality = v;
        save();
        game.setQuality(v || game.detectedPreset || 'high');
      },
      hint: t('opt.qualityHint')
    },
    {
      type: 'select', label: t('opt.fps'),
      options: [{ value: 0, label: t('opt.uncapped') }, { value: 60, label: '60' }, { value: 30, label: '30' }],
      get: () => s.fpsCap || 0,
      set: (v) => {
        s.fpsCap = v;
        save();
        game.applyFpsCap?.();
      }
    },
    {
      type: 'select', label: t('opt.difficulty'),
      options: [{ value: 'easy', label: 'EASY' }, { value: 'normal', label: 'NORMAL' }, { value: 'arcade', label: 'ARCADE' }],
      get: () => s.difficulty || 'normal',
      set: (v) => { s.difficulty = v; save(); }
    },
    {
      type: 'select', label: t('opt.assist'),
      options: [{ value: 0, label: 'OFF' }, { value: 1, label: 'LOW' }, { value: 2, label: 'HIGH' }],
      get: () => s.assist,
      set: (v) => { s.assist = v; save(); if (game.state?.lockon) game.state.lockon.assist = v; },
      hint: t('opt.assistHint')
    },
    { type: 'toggle', label: t('opt.autoFire'), get: () => s.autoFire, set: (v) => { s.autoFire = v; save(); } },
    {
      type: 'toggle', label: tr('opt.autoMissile', 'AUTO MISSILE'),
      get: () => s.autoMissile ?? s.difficulty === 'easy',
      set: (v) => { s.autoMissile = v; save(); },
      hint: tr('opt.autoMissileHint', 'Hold MISSILE to ripple one missile at every new lock.')
    },
    {
      type: 'select', label: tr('opt.climaxMode', 'CLIMAX BUTTON'),
      options: [{ value: false, label: tr('opt.climaxHold', 'HOLD') }, { value: true, label: tr('opt.climaxToggle', 'PRESS = ON / OFF') }],
      get: () => !!s.climaxToggle,
      set: (v) => { s.climaxToggle = v; save(); }
    },
    {
      type: 'select', label: t('opt.missileMode'),
      options: [{ value: 'tap', label: t('opt.tap') }, { value: 'paint', label: t('opt.paint') }],
      get: () => s.missileMode, set: (v) => { s.missileMode = v; save(); }
    },
    { type: 'toggle', label: t('opt.invertY'), get: () => s.invertY, set: (v) => { s.invertY = v; game.input.invertY = v; save(); } },
    { type: 'toggle', label: t('opt.mouse'), get: () => s.mouseFlight, set: (v) => { s.mouseFlight = v; game.mouse.enabled = v; save(); } },
    {
      type: 'toggle', label: t('opt.tilt'), get: () => s.tilt,
      set: async (v) => {
        s.tilt = v;
        if (v) s.tilt = await game.touch.enableTilt();
        else game.touch.disableTilt();
        save();
      }
    },
    { type: 'slider', label: t('opt.master'), get: () => s.volMaster, set: (v) => { s.volMaster = v; vol(); save(); } },
    { type: 'slider', label: t('opt.music'), get: () => s.volMusic, set: (v) => { s.volMusic = v; vol(); save(); } },
    { type: 'slider', label: t('opt.sfx'), get: () => s.volSfx, set: (v) => { s.volSfx = v; vol(); save(); } },
    {
      type: 'select', label: t('opt.lang'),
      options: [{ value: 'en', label: 'ENGLISH' }, { value: 'th', label: 'ภาษาไทย' }],
      get: () => s.lang,
      set: (v) => { s.lang = v; setLang(v); save(); game.events.emit('lang', v); }
    },
    { type: 'slider', label: t('opt.shake'), get: () => s.shake ?? 1, set: (v) => { s.shake = v; game.rig.shakeScale = v; save(); } },
    { type: 'toggle', label: t('opt.flashing'), get: () => s.reducedFlashing, set: (v) => { s.reducedFlashing = v; save(); } },
    { type: 'toggle', label: t('opt.colorblind'), get: () => s.colorblindReticle, set: (v) => { s.colorblindReticle = v; game.hud.colorblind = v; save(); } },
    { type: 'button', label: t('opt.back'), onSelect: onBack }
  ];
  return new Menu({ items, className: 'menu-options', title: t('opt.title'), onBack, game });
}
