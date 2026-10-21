# Plan: 002-diseno-atlas-white-label

**Spec**: [spec.md](spec.md) · **Branch**: `002-diseno-atlas-white-label`

## Decisiones técnicas

- **Tokens**: variables CSS en `globals.css` (`:root`) con los valores exactos
  del handoff; Tailwind mapea a las variables (se reescribe la paleta actual —
  el tema oscuro desaparece). El acento SIEMPRE vía `--accent*` para poder
  sobreescribirlo en runtime (white-label).
- **Acento**: presets del handoff (`ACCENTS`: steel `#3f5972`, graphite
  `#4b5563`, teal `#3f6b66`, plum `#5f5470`, cada uno con
  hover/soft/tint/text). Color personalizado → derivación en
  `src/lib/branding.ts` (hover = oscurecer 12%, soft/tint = mezclas con blanco,
  text = oscurecer 25%; si la luminancia del base es muy alta, oscurecer el
  base para contraste con texto blanco).
- **Persistencia white-label**: `organization.metadata` (JSON, columna ya
  existente de Better Auth) → `{ brandName, accent }`. API
  `GET/PUT /api/settings/branding` (PUT owner-only). GET también responde sin
  sesión con la marca de la única org (para login) — expone solo nombre+color.
- **Aplicación SSR sin flash**: el root layout (server) lee la marca y pinta
  `<style>:root{--accent:…}</style>` + `<title>`; los cambios en Configuración
  refrescan con `router.refresh()`.
- **Fuente**: Geist self-hosted vía `next/font/google` con `display: swap`
  (next/font descarga en BUILD y sirve local — sin CDN en runtime ✓).
- **Estructura**: se conservan todos los componentes/páginas y su lógica; el
  cambio es de presentación (clases/estructura visual) + panel colapsable +
  stepper + filtros/búsqueda client-side ya existentes o triviales.
- **Iconos**: se mantiene lucide-react (stroke fino 1.7 vía prop).

## Constitution check

Sin nuevas dependencias de runtime (fuente en build) ✓ · metadata por org ✓ ·
sin cambios de webhook/idempotencia ✓ · verificación en vivo con Playwright ✓.

## Tareas

- [X] T201 Tokens Atlas: `globals.css` (variables exactas) + `tailwind.config.ts`
      remapeado + fuente Geist via next/font en `src/app/layout.tsx`
- [X] T202 `src/lib/branding.ts`: presets ACCENTS, derivación de acento
      personalizado (+contraste), tipos; unit test de derivación/contraste
- [X] T203 API `GET/PUT /api/settings/branding` (metadata de la org; GET sin
      sesión → marca de la única org; PUT owner-only, Zod name≤30/hex)
- [X] T204 Root layout SSR: inyectar variables de acento + título con el nombre;
      login usa el nombre de la marca
- [X] T205 Nav Atlas: reescribir `(app)/layout.tsx` + `nav-link` (brand con
      inicial sobre acento, badge no-leídos en Bandeja, Ajustes+usuario abajo)
- [X] T206 Bandeja: lista (buscador, filtros Todas/No leídas, filas del handoff
      con presencia/preview/badge/tag de etapa)
- [X] T207 Hilo + composer: fondo chat, day-sep, burbujas agrupadas con hora
      interna y doble check, chips de plantillas aprobadas, send-btn de acento
- [X] T208 Panel de detalles colapsable: contacto, stepper de etapas del
      pipeline (mueve el lead al hacer clic en un paso), notas, IA/handoff;
      persistencia en localStorage; botón reabrir
- [X] T209 Re-tematizar páginas restantes (pipeline, contactos, agente, lab,
      configuración, auth) con los componentes/tokens nuevos
- [X] T210 Configuración → Marca: UI (nombre + presets + color picker custom,
      vista previa), guardado + refresh
- [X] T211 Gate (typecheck/lint/build/test) + E2E: guion
      `tests/e2e/us-diseno.md` — regresión funcional de bandeja (SSE, enviar,
      ventana cerrada), colapsar/reabrir panel, stepper mueve etapa,
      white-label cambia nombre+acento y persiste; capturas nuevas para README
- [X] T212 Commit + merge a main tras verificación (OK del flujo 001 se asume
      SOLO si el dueño lo da — preguntar antes de merge)
