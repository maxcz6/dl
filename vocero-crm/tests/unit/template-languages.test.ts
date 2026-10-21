import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_LANGUAGE,
  isTemplateLanguage,
  TEMPLATE_LANGUAGE_GROUPS,
  TEMPLATE_LANGUAGES,
  templateLanguageName,
} from "@/lib/template-languages";
import { templateWarnings } from "@/lib/templates";

/** La lista oficial de Meta («Supported Languages», 21-may-2026), tal cual. */
const META = `af sq ar ar_EG ar_AE ar_LB ar_MA ar_QA az be_BY bn bn_IN bg ca zh_CN zh_HK zh_TW hr cs da prs_AF nl nl_BE en en_GB en_US en_AE en_AU en_CA en_GH en_IE en_IN en_JM en_MY en_NZ en_QA en_SG en_UG en_ZA et fil fi fr fr_BE fr_CA fr_CH fr_CI fr_MA ka de de_AT de_CH el gu ha he hi hu id ga it ja kn kk rw_RW ko ky_KG lo lv lt mk ms ml mr nb ps_AF fa pl pt_BR pt_PT pa ro ru sr si_LK sk sl es es_AR es_CL es_CO es_CR es_DO es_EC es_HN es_MX es_PA es_PE es_ES es_UY sw sv ta te th tr uk ur uz vi zu`.split(" ");

describe("idiomas de plantilla", () => {
  it("son exactamente los que Meta acepta, sin repetidos", () => {
    const codes = TEMPLATE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual([...META].sort());
  });

  it("el español va primero y el de México es el predeterminado", () => {
    expect(TEMPLATE_LANGUAGES[0]?.code).toBe(DEFAULT_TEMPLATE_LANGUAGE);
    expect(DEFAULT_TEMPLATE_LANGUAGE).toBe("es_MX");
    expect(TEMPLATE_LANGUAGE_GROUPS[0]?.id).toBe("es");
  });

  it("valida y nombra", () => {
    expect(isTemplateLanguage("es_CO")).toBe(true);
    expect(isTemplateLanguage("es_LA")).toBe(false);
    expect(templateLanguageName("pt_BR")).toBe("Portugués (Brasil)");
    // Un código que llegue sincronizado de Meta y no conozcamos se muestra tal cual.
    expect(templateLanguageName("xx_YY")).toBe("xx_YY");
  });
});

describe("templateWarnings", () => {
  it("no avisa de un mensaje bien armado", () => {
    expect(templateWarnings("Hola {{1}}, te recordamos tu cita del {{2}} a las {{3}}. Responde para cambiarla.")).toEqual([]);
    expect(templateWarnings("")).toEqual([]);
  });

  it("avisa si empieza o termina con variable", () => {
    expect(templateWarnings("{{1}}, tu pedido está listo para recoger hoy")).toHaveLength(1);
    expect(templateWarnings("Tu pedido está listo para recoger, {{1}}.")[0]).toMatch(/Termina/);
  });

  it("avisa de variables juntas y de mucho hueco para poco texto", () => {
    expect(templateWarnings("Hola, tu cita es {{1}} {{2}} en nuestra clínica de siempre").some((w) => /juntas/.test(w))).toBe(true);
    expect(templateWarnings("Hola {{1}} y {{2}} y {{3}} ok").some((w) => /muchas variables/.test(w))).toBe(true);
  });
});
