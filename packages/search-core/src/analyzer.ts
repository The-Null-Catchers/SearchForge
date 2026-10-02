import type { IndexSettings } from "@searchforge/shared";
import type { AnalyzerToken } from "./types.js";

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_LETTER = /[\u0600-\u06FF]/u;

export function normalizeArabic(input: string, settings: IndexSettings["arabic"]): string {
  let value = input.normalize("NFKC");
  if (settings.removeTatweel) value = value.replace(/\u0640/g, "");
  if (settings.removeDiacritics) value = value.replace(ARABIC_DIACRITICS, "");
  if (settings.normalizeAlef) value = value.replace(/[أإآٱ]/g, "ا");
  if (settings.normalizeYa) value = value.replace(/[ىی]/g, "ي");
  if (settings.normalizeTaaMarbuta) value = value.replace(/ة/g, "ه");
  return value;
}

export function lightStemArabic(term: string): string {
  let value = term;
  const prefixes = ["وال", "بال", "كال", "فال", "لل", "ال"];
  for (const prefix of prefixes) {
    if (value.startsWith(prefix) && value.length - prefix.length >= 3) {
      value = value.slice(prefix.length);
      break;
    }
  }
  const suffixes = ["يات", "يون", "يين", "ات", "ون", "ين", "ها", "هم", "هن", "ية", "ه", "ي"];
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 3) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  return value;
}

export function stemEnglish(term: string): string {
  if (term.length < 4) return term;
  let value = term;
  if (value.endsWith("sses")) value = value.slice(0, -2);
  else if (value.endsWith("ies")) value = value.slice(0, -2);
  else if (value.endsWith("ss")) return value;
  else if (value.endsWith("s")) value = value.slice(0, -1);

  if (value.endsWith("eed") && value.length > 5) value = value.slice(0, -1);
  else if (value.endsWith("ing") && value.length > 6) value = value.slice(0, -3);
  else if (value.endsWith("ed") && value.length > 5) value = value.slice(0, -2);

  const replacements: Array<[string, string]> = [
    ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"],
    ["izer", "ize"], ["bli", "ble"], ["alli", "al"], ["entli", "ent"],
    ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"],
    ["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"],
    ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"]
  ];
  for (const [suffix, replacement] of replacements) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 3) {
      value = value.slice(0, -suffix.length) + replacement;
      break;
    }
  }
  if (value.endsWith("e") && value.length > 4) value = value.slice(0, -1);
  return value;
}

function isArabic(value: string): boolean {
  return ARABIC_LETTER.test(value);
}

function stopWordSet(settings: IndexSettings, language: "ar" | "en"): Set<string> {
  return new Set(settings.stopWords[language] ?? []);
}

export class Analyzer {
  constructor(private readonly settings: IndexSettings) {}

  normalize(input: string): string {
    const unicode = input.normalize("NFKC").toLocaleLowerCase("en-US");
    return normalizeArabic(unicode, this.settings.arabic);
  }

  analyze(input: string): AnalyzerToken[] {
    const normalized = this.normalize(input);
    const raw = normalized
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

    const arStop = stopWordSet(this.settings, "ar");
    const enStop = stopWordSet(this.settings, "en");
    const tokens: AnalyzerToken[] = [];

    for (let position = 0; position < raw.length; position += 1) {
      const original = raw[position]!;
      const arabic = isArabic(original);
      if ((arabic ? arStop : enStop).has(original)) continue;
      const term = arabic && this.settings.arabic.lightStem
        ? lightStemArabic(original)
        : arabic
          ? original
          : stemEnglish(original);
      if (term.length === 0) continue;
      tokens.push({ term, original, position });
    }
    return tokens;
  }

  analyzeWithOffsets(input: string): Array<AnalyzerToken & { start: number; end: number }> {
    const tokens: Array<AnalyzerToken & { start: number; end: number }> = [];
    const surfaces = input.matchAll(/[\p{L}\p{N}\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]+/gu);
    let position = 0;

    for (const match of surfaces) {
      const surface = match[0];
      const analyzed = this.analyze(surface);
      const start = match.index ?? 0;
      for (const token of analyzed) {
        tokens.push({
          ...token,
          position,
          original: surface,
          start,
          end: start + surface.length
        });
      }
      position += 1;
    }

    return tokens;
  }

  analyzeQueryTerm(input: string): string[] {
    return this.analyze(input).map((token) => token.term);
  }
}
