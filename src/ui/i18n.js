import en from './strings/en.js';
import th from './strings/th.js';

const TABLES = { en, th };
let lang = 'en';

export function setLang(l) {
  lang = TABLES[l] ? l : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
export const getLang = () => lang;

/** Translate a key; radio lines return [callsign, text]. */
export function t(key) {
  const v = TABLES[lang][key] ?? TABLES.en[key];
  return v ?? key;
}
