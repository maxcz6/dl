/**
 * Idiomas que Meta acepta para plantillas de WhatsApp Cloud API.
 *
 * Copiado de la lista oficial («Supported Languages», actualizada por Meta el
 * 21-may-2026). El código es lo que viaja a Meta; el nombre es para el
 * selector. Un código fuera de esta lista Meta lo rechaza, así que el servidor
 * valida contra ella antes de gastar la llamada.
 *
 * Puro y sin dependencias: lo usan la API, la pantalla de Plantillas y el
 * selector de la Bandeja.
 */

export type TemplateLanguageGroup = "es" | "pt-en" | "otros";

type Entry = { code: string; name: string; group: TemplateLanguageGroup };

const ESPANOL: Entry[] = [
  { code: "es_MX", name: "Español (México)", group: "es" },
  { code: "es", name: "Español (general)", group: "es" },
  { code: "es_AR", name: "Español (Argentina)", group: "es" },
  { code: "es_CL", name: "Español (Chile)", group: "es" },
  { code: "es_CO", name: "Español (Colombia)", group: "es" },
  { code: "es_CR", name: "Español (Costa Rica)", group: "es" },
  { code: "es_EC", name: "Español (Ecuador)", group: "es" },
  { code: "es_ES", name: "Español (España)", group: "es" },
  { code: "es_HN", name: "Español (Honduras)", group: "es" },
  { code: "es_PA", name: "Español (Panamá)", group: "es" },
  { code: "es_PE", name: "Español (Perú)", group: "es" },
  { code: "es_DO", name: "Español (República Dominicana)", group: "es" },
  { code: "es_UY", name: "Español (Uruguay)", group: "es" },
];

const PORTUGUES_E_INGLES: Entry[] = [
  { code: "pt_BR", name: "Portugués (Brasil)", group: "pt-en" },
  { code: "pt_PT", name: "Portugués (Portugal)", group: "pt-en" },
  { code: "en_US", name: "Inglés (EE. UU.)", group: "pt-en" },
  { code: "en", name: "Inglés (general)", group: "pt-en" },
  { code: "en_GB", name: "Inglés (Reino Unido)", group: "pt-en" },
  { code: "en_CA", name: "Inglés (Canadá)", group: "pt-en" },
  { code: "en_AU", name: "Inglés (Australia)", group: "pt-en" },
  { code: "en_IE", name: "Inglés (Irlanda)", group: "pt-en" },
  { code: "en_IN", name: "Inglés (India)", group: "pt-en" },
  { code: "en_JM", name: "Inglés (Jamaica)", group: "pt-en" },
  { code: "en_NZ", name: "Inglés (Nueva Zelanda)", group: "pt-en" },
  { code: "en_SG", name: "Inglés (Singapur)", group: "pt-en" },
  { code: "en_ZA", name: "Inglés (Sudáfrica)", group: "pt-en" },
  { code: "en_AE", name: "Inglés (Emiratos Árabes)", group: "pt-en" },
  { code: "en_GH", name: "Inglés (Ghana)", group: "pt-en" },
  { code: "en_MY", name: "Inglés (Malasia)", group: "pt-en" },
  { code: "en_QA", name: "Inglés (Catar)", group: "pt-en" },
  { code: "en_UG", name: "Inglés (Uganda)", group: "pt-en" },
];

const OTROS: Entry[] = (
  [
    ["af", "Afrikáans"], ["sq", "Albanés"], ["de", "Alemán"],
    ["de_AT", "Alemán (Austria)"], ["de_CH", "Alemán (Suiza)"], ["ar", "Árabe"],
    ["ar_EG", "Árabe (Egipto)"], ["ar_AE", "Árabe (Emiratos Árabes)"],
    ["ar_LB", "Árabe (Líbano)"], ["ar_MA", "Árabe (Marruecos)"],
    ["ar_QA", "Árabe (Catar)"], ["az", "Azerí"], ["be_BY", "Bielorruso"],
    ["bn", "Bengalí"], ["bn_IN", "Bengalí (India)"], ["bg", "Búlgaro"],
    ["kn", "Canarés"], ["ca", "Catalán"], ["cs", "Checo"],
    ["zh_CN", "Chino (China)"], ["zh_HK", "Chino (Hong Kong)"],
    ["zh_TW", "Chino (Taiwán)"], ["si_LK", "Cingalés"], ["ko", "Coreano"],
    ["hr", "Croata"], ["da", "Danés"], ["prs_AF", "Darí"], ["sk", "Eslovaco"],
    ["sl", "Esloveno"], ["et", "Estonio"], ["fil", "Filipino"],
    ["fi", "Finés"], ["fr", "Francés"], ["fr_BE", "Francés (Bélgica)"],
    ["fr_CA", "Francés (Canadá)"], ["fr_CI", "Francés (Costa de Marfil)"],
    ["fr_MA", "Francés (Marruecos)"], ["fr_CH", "Francés (Suiza)"],
    ["ka", "Georgiano"], ["el", "Griego"], ["gu", "Guyaratí"], ["ha", "Hausa"],
    ["he", "Hebreo"], ["hi", "Hindi"], ["hu", "Húngaro"], ["id", "Indonesio"],
    ["ga", "Irlandés"], ["it", "Italiano"], ["ja", "Japonés"], ["kk", "Kazajo"],
    ["rw_RW", "Kinyarwanda"], ["ky_KG", "Kirguís"], ["lo", "Lao"],
    ["lv", "Letón"], ["lt", "Lituano"], ["mk", "Macedonio"],
    ["ml", "Malayalam"], ["ms", "Malayo"], ["mr", "Maratí"],
    ["nl", "Neerlandés"], ["nl_BE", "Neerlandés (Bélgica)"], ["nb", "Noruego"],
    ["pa", "Panyabí"], ["ps_AF", "Pastún"], ["fa", "Persa"], ["pl", "Polaco"],
    ["ro", "Rumano"], ["ru", "Ruso"], ["sr", "Serbio"], ["sw", "Suajili"],
    ["sv", "Sueco"], ["th", "Tailandés"], ["ta", "Tamil"], ["te", "Telugu"],
    ["tr", "Turco"], ["uk", "Ucraniano"], ["ur", "Urdu"], ["uz", "Uzbeko"],
    ["vi", "Vietnamita"], ["zu", "Zulú"],
  ] as const
).map(([code, name]) => ({ code, name, group: "otros" as const }));

export const TEMPLATE_LANGUAGES: readonly Entry[] = [
  ...ESPANOL,
  ...PORTUGUES_E_INGLES,
  ...OTROS,
];

export const TEMPLATE_LANGUAGE_GROUPS: { id: TemplateLanguageGroup; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "pt-en", label: "Portugués e inglés" },
  { id: "otros", label: "Otros idiomas" },
];

export const DEFAULT_TEMPLATE_LANGUAGE = "es_MX";

const BY_CODE = new Map(TEMPLATE_LANGUAGES.map((l) => [l.code, l.name]));

export function isTemplateLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

/** Nombre legible; un código desconocido (p. ej. sincronizado de Meta) se muestra tal cual. */
export function templateLanguageName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
