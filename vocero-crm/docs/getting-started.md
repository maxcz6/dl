# Getting Started

Esta guía te lleva de "carpeta recién clonada" a "primera feature corriendo el loop SDD".

## 0. Requisitos

- **Claude Code** instalado y autenticado.
- **git**.
- **PowerShell** (los scripts de Spec Kit viven en `.specify/scripts/powershell/`).
- Opcional: **Node.js + npx** (para MCP por `npx`), y el stack que elijas para la app.

## 1. Haz tuyo el starter

```bash
# copia/renombra esta carpeta para tu proyecto y entra en ella
git init
git add -A
git commit -m "chore: SDD starter"
```

## 2. Define tu constitución (el "qué no se negocia")

Ejecuta `/speckit-constitution` y describe tu producto y tu nicho. Edita
[`.specify/memory/constitution.md`](../.specify/memory/constitution.md):

- **Rellena el Principio VIII** (`Foco Vertical [DEFINE-TU-NICHO]`) — es el que ancla el
  producto a un dominio concreto.
- **Ajusta o elimina** los principios I-VII que no apliquen (p. ej. borra "Multi-Tenancy"
  si tu producto es single-tenant; relaja "Self-Hosted" si aceptas servicios gestionados).
- Sube la versión y actualiza el Sync Impact Report del encabezado.

## 3. Personaliza `CLAUDE.md`

Reemplaza los `[corchetes]`: nombre del proyecto, stack real (framework, BD, auth, deploy),
y deja vacío el bloque `## Active feature` hasta tu primera feature. **No borres** las
secciones de metodología (manejo de credenciales, Definición de Hecho REFORZADA, Modo
Objetivo / Loop SDD) — son el núcleo evergreen.

## 4. MCP + credenciales

- Configura los servidores MCP que uses: ver [mcp-setup.md](mcp-setup.md).
- `pnpm init-env` crea `.env` con los secretos ya generados (o `cp .env.example .env`
  y rellena los `REEMPLAZA_...`); `pnpm doctor` lo revisa. `.env` está gitignored.

## 5. Tu primera feature

Dos formas equivalentes de arrancar:

**A) Modo Objetivo (recomendado).** Describe un objetivo y deja que el orquestador corra el
loop: `/loop-sdd Quiero que [comportamiento observable del producto]`. Ver
[sdd-workflow.md](sdd-workflow.md).

**B) Paso a paso.** `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`.

Cada feature crea su carpeta en [`specs/`](../specs/) (`NNN-nombre/` con
`spec.md`, `plan.md`, `tasks.md`, etc.).

## 6. Verifica antes de declarar "Hecho"

El gate técnico (typecheck + lint + build) es el piso. El techo es un **self-test de
comportamiento E2E**: ejerce el flujo real como usuario y prueba el camino infeliz. Lo que
no puedas verificar tú, márcalo *pendiente de verificación humana*.

## Checklist de personalización (búsqueda de placeholders)

- [ ] `CLAUDE.md` — `[NOMBRE_DEL_PROYECTO]`, stack, feature activa
- [ ] `.specify/memory/constitution.md` — Principio VIII + ajustes I-VII + fechas/versión
- [ ] `LICENSE` — titular del copyright
- [ ] `.env.example` / `.env` — `REEMPLAZA_...`
- [ ] `.mcp.json` — servidores que realmente uses
- [ ] Subagentes (`.claude/agents/`) — solo si tu deploy/proveedor difieren de los defaults
