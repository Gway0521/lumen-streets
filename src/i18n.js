import en from "./locales/en.json" with { type: "json" };
import zhTW from "./locales/zh-TW.json" with { type: "json" };

export const locales = { en, "zh-TW": zhTW };
export let locale =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("lang") === "zh-TW"
    ? "zh-TW"
    : "en";
export function t(key, values = {}) {
  const text = locales[locale][key] ?? en[key];
  if (text === undefined) throw new Error(`Missing translation: ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name) =>
    String(values[name] ?? `{${name}}`),
  );
}
const names = {
  xinyi: "Xinyi, Taipei",
  ntu: "Gongguan, Taipei",
  tokyo: "Shinjuku, Tokyo",
  sapporo: "Sapporo, Hokkaido",
  shanghai: "The Bund, Shanghai",
  beijing: "Dongcheng, Beijing",
  seattle: "South Lake Union, Seattle",
  washington: "Downtown, Washington DC",
};
export const placeName = (place) =>
  locale === "zh-TW" ? place.name : (names[place.id] ?? place.english);
export function applyLocale() {
  document.documentElement.lang = locale;
  document.title = t("title");
  document.querySelector('meta[name="description"]').content = t("description");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  const button = document.getElementById("language");
  button.textContent = locale === "en" ? "繁中" : "EN";
}

export function setLocale(next) {
  if (!Object.hasOwn(locales, next)) throw new Error("Unsupported locale");
  locale = next;
}
