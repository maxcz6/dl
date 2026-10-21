# Feature Specification: Rediseño "Atlas" + White-label (002-diseno-atlas-white-label)

**Feature Branch**: `002-diseno-atlas-white-label`

**Created**: 2026-07-10

**Status**: Draft

**Input**: Adoptar el sistema de diseño del handoff "Atlas — Bandeja unificada"
(prototipo hi-fi generado con Claude Design; referencia local, no committeada) en
toda la app, y hacer el CRM white-label: nombre y color de acento configurables
desde Configuración.

## Contexto

- Referencia de diseño: handoff hi-fi con tokens exactos (modo claro, estética
  Linear/Notion, neutros fríos, un solo acento azul acero apagado `#3f5972`,
  tipografía Geist, radios 7/10/14, sombras suaves). Se RECREA con el stack del
  repo (Tailwind + variables CSS); no se copia el código del prototipo.
- Vocero es genérico: cada instancia lo opera un negocio distinto → la marca
  visible (nombre + acento) debe ser suya, no "Vocero".

## User Stories

### US1 — Sistema de diseño Atlas en toda la app (P1)

Como usuario del CRM, toda la interfaz (bandeja, pipeline, contactos, agente,
laboratorio, configuración, login) usa el tema claro sobrio del handoff: mismos
tokens de color/tipografía/radios/sombras, nav lateral estilo Atlas (brand
arriba, items con tinte de acento al activo, usuario abajo) y componentes
consistentes (píldoras, badges, tarjetas, inputs con halo de acento al focus).

**Aceptación**:
1. Tokens globales portados a variables CSS + Tailwind (valores EXACTOS de la
   sección Design Tokens del handoff; el acento vía variables para poder
   cambiarlo en runtime).
2. Nav izquierda 224px según handoff: brand (cuadro 30px con inicial + nombre
   del CRM + subtítulo), items con badge de no-leídos en Bandeja, Ajustes y
   usuario al fondo.
3. Tipografía Geist (self-hosted vía next/font — sin CDN en runtime,
   Constitución II) con fallbacks del handoff.
4. Login/registro y todas las páginas re-tematizadas (adiós tema oscuro).

### US2 — Bandeja rediseñada (P1)

Como operador, la bandeja replica la pantalla del handoff: lista de 360px
(buscador con ⌘K visual, filtros píldora Todas/No leídas, filas con presencia,
preview con "Tú:", badge de no leídos, tag del negocio/etapa), hilo con fondo
`#f4f5f7`, separador de día, burbujas (entrante blanca / saliente `#f2f5f8` con
doble check de acento), composer con chips de plantillas aprobadas y botón
enviar de acento, y **panel de detalles colapsable** (contacto + etapa con
stepper del pipeline + notas + toggle IA + handoff).

**Aceptación**:
1. Layout 4 columnas: nav 224 · lista 360 · hilo flex-1 · panel 320 colapsable
   (transición 0.22s, botón para reabrir en el header del chat).
2. Burbujas agrupadas por emisor consecutivo; hora dentro de la burbuja; doble
   check con color de acento según estado (read).
3. Stepper vertical de etapas del pipeline en el panel (hecho/actual/pendiente
   según la etapa del lead), reemplaza al badge estático.
4. Filtros: "Todas" y "No leídas" con conteos (Vocero no tiene asignación de
   agentes en v1 — se omite "Sin asignar/Mías").
5. Búsqueda por nombre/teléfono/preview.
6. Toda la funcionalidad existente se conserva (SSE, ventana 24h, plantillas,
   IA, marcar leído).

### US3 — White-label desde Configuración (P1)

Como negocio/agencia, en Configuración → Marca defino el **nombre del CRM** y
el **color de acento**, y toda la UI los refleja al instante (brand de la nav,
título del documento, acentos, botones, badges).

**Aceptación**:
1. Nueva pestaña Configuración → Marca: input de nombre (default "Vocero") y
   selector de acento con las 4 opciones sobrias del handoff (Azul acero,
   Grafito, Verde apagado, Ciruela) + opción de color personalizado (color
   picker) del que se derivan hover/soft/tint/text automáticamente.
2. Persistencia por organización en BD (`organization.metadata` o tabla
   propia); GET público a la sesión; aplicado como variables CSS en el layout
   (SSR, sin flash).
3. El nombre aparece en: brand de la nav, `<title>`, página de login (que es
   pública: usa el nombre de la única org de la instancia).
4. Sin configurar → defaults (nombre "Vocero", acento azul acero `#3f5972`).

## Edge cases

- Acento personalizado con contraste insuficiente sobre blanco → derivar
  `--accent-text` oscurecido y validar que el texto blanco sobre el acento
  cumpla contraste razonable (si muy claro, oscurecer el acento base).
  R8: "razonable" es AA — la tinta encima del acento es blanca solo si pasa
  4.5:1; si no, casi negra (`#0f1419`), en los dos temas y en la barra. El
  acento base se oscurece (claro) o aclara (oscuro) solo hasta que el relleno
  se despegue del fondo y alguna de las dos tintas pase.
- Nombre vacío → vuelve al default. Longitud máx 30.
- Panel colapsado persiste en localStorage.
- `prefers-reduced-motion` → transiciones ~0ms.

## Success Criteria

- **SC-1**: Comparación visual con el handoff: la bandeja replica layout,
  tokens y estados (revisión con capturas, juicio humano final).
- **SC-2**: Cambiar nombre+acento en Configuración se refleja en toda la UI sin
  recargar a mano y persiste tras recargar.
- **SC-3**: Los E2E funcionales de 001 siguen verdes (sin regresión de
  comportamiento).
- **SC-4**: Sin dependencias runtime nuevas (fuente self-hosted; Constitución II).

## Out of Scope

Modo oscuro, asignación de conversaciones a agentes ("Sin asignar/Mías"),
negocios/deals con valor monetario (el panel muestra contacto+lead reales de
Vocero), logo por imagen (v1: inicial sobre acento), densidad configurable.
