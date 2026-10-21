# Arquitectura de tres agentes

El trabajo se reparte entre **tres agentes en dos niveles**. Lo importante: el
**orquestador no es un subagente ni un archivo** — es la **sesión principal de Claude
Code**, la que se abre cuando empiezas a interactuar. Esa sesión es quien **invoca** a los
subagentes especializados cuando hace falta.

```
┌──────────────────────────────────────────────────────────────┐
│  ORQUESTADOR = la sesión principal de Claude Code (tú/Claude) │
│  Gobernado por: CLAUDE.md  +  skill loop-sdd                  │
│  Rol: corre el loop SDD (Discover→Plan→Execute→Verify→Iterate)│
│       y DELEGA en los subagentes vía la herramienta Agent.    │
└───────────────┬──────────────────────────────┬───────────────┘
                │ invoca                        │ invoca
                ▼                               ▼
   ┌─────────────────────────┐     ┌──────────────────────────────┐
   │  Subagente: deploy-ops   │     │ Subagente: public-site-builder│
   │  .claude/agents/         │     │  .claude/agents/             │
   │  deploy-ops.md           │     │  public-site-builder.md      │
   │                          │     │                              │
   │  Deploy, estado de       │     │  Páginas públicas/legales    │
   │  contenedores, logs,     │     │  (landing, privacidad,       │
   │  healthchecks, diagnós-  │     │  términos, eliminación) +    │
   │  tico de fallos.         │     │  doc de config del proveedor │
   │  NO escribe código app.  │     │  externo (OAuth/panel).      │
   └─────────────────────────┘     └──────────────────────────────┘
```

## 1. Orquestador (la sesión principal)

No lo creas ni lo configures como subagente. Su "personalidad" y reglas viven en:
- [`CLAUDE.md`](../CLAUDE.md) — contrato de trabajo: metodología, Definición de Hecho
  REFORZADA, Modo Objetivo / Loop SDD.
- skill [`loop-sdd`](../.claude/skills/loop-sdd/SKILL.md) — el punto de entrada al loop.

Su trabajo: entender el objetivo, correr el flujo SDD, **decidir cuándo delegar** en un
subagente, y verificar el resultado en vivo antes de declarar "Hecho".

## 2. Subagentes (en `.claude/agents/`)

Se invocan con la herramienta **Agent** (`subagent_type: "deploy-ops"` /
`"public-site-builder"`). Tienen su propio contexto y su propia **memoria de proyecto** en
`.claude/agent-memory/<agente>/` (versionada, compartida con el equipo).

- **`deploy-ops`** — operaciones e infraestructura. Despliega, lee logs, verifica
  healthchecks, diagnostica fallos. **Nunca** escribe código de aplicación; sugiere fixes en
  prosa. Pensado para un PaaS self-hosted (Coolify de referencia) — parametrízalo a tu
  plataforma.
- **`public-site-builder`** — la superficie pública/legal del producto + el documento con
  los valores exactos para el panel de un proveedor externo (OAuth, pagos, API de
  mensajería…). Solo rutas públicas; lee el nicho/diseño del proyecto.

## ¿Por qué este reparto?

- **Aislamiento de contexto**: el trabajo de deploy o de páginas legales no contamina el
  contexto del orquestador, y viceversa.
- **Fronteras de seguridad**: `deploy-ops` no toca código; `public-site-builder` no toca
  auth/BD/webhooks. Menos superficie para romper algo.
- **Memoria especializada**: cada subagente acumula su propio conocimiento (IDs de la
  plataforma, dominio público, modos de fallo recurrentes) sin saturar la memoria global.

## Añadir más subagentes

¿Necesitas un especialista nuevo (p. ej. un revisor de seguridad, un constructor del
agente IA del canal)? Crea otro archivo en `.claude/agents/` con su frontmatter
(`name`, `description` con ejemplos, `model`, `memory: project`) y su prompt de sistema.
El orquestador lo descubrirá y podrá delegarle.
