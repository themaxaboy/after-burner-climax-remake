import en from './strings/en.js';
import th from './strings/th.js';
import stagesEn from './strings/stages_en.js';
import stagesTh from './strings/stages_th.js';

// Tables are merged per language: UI strings, then stage strings, then any
// tables registered at runtime (e.g. radio subtitles).
const TABLES = { en: { ...en, ...stagesEn }, th: { ...th, ...stagesTh } };
let lang = 'en';

export function setLang(l) {
  lang = TABLES[l] ? l : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
export const getLang = () => lang;

/** Merge extra strings into a language table (later wins). */
export function registerStrings(l, table) {
  TABLES[l] = Object.assign(TABLES[l] || {}, table);
}

/** Translate a key; radio lines return [callsign, text]. */
export function t(key) {
  const v = TABLES[lang][key] ?? TABLES.en[key];
  return v ?? key;
}

/** True when the key exists in the English table. */
export function hasString(key) {
  return key in TABLES.en;
}
