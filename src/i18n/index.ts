/**
 * Interface language. `t` is the active dictionary; every module reads it at
 * render time, so switching language only needs a re-render.
 */
import { en } from "./en.ts";
import { ptBR } from "./pt-BR.ts";
import type { Strings } from "./pt-BR.ts";

export type Language = "pt-BR" | "en";
export type { Strings };

export const LANGUAGES: Record<Language, Strings> = { "pt-BR": ptBR, en };
export const LANGUAGE_NAMES: Record<Language, string> = { "pt-BR": "Português (Brasil)", en: "English" };

export let t: Strings = ptBR;

export function setLanguage(lang: Language) {
  t = LANGUAGES[lang] ?? ptBR;
}
