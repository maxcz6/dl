# Propuesta de enmienda constitucional — Conectores opcionales (1.3.0 → 1.4.0)

**Feature**: `015-motor-agenda-universal` · **Fecha**: 2026-08-26 ·
**Estado**: **RATIFICADA** por el responsable del proyecto el 2026-08-26 y
**APLICADA** — constitución 1.3.0 → 1.4.0 con su Sync Impact Report, propagada
a `CLAUDE.md`. (Governance: "toda enmienda se propone por escrito describiendo
el cambio y su motivación, se aprueba por el responsable del proyecto".)

## Qué se propone cambiar

**Principio II — Soberanía / Self-Hosted (ENDURECIDO)**. Hoy la lista de
dependencias externas en runtime es CERRADA (WhatsApp Cloud API + proveedor LLM
opcional) y el principio declara: *"PROHIBIDO en v1: almacenamiento de objetos
externo (S3/R2), servicios de email, Stripe u otro billing, y servicios de
Google."*

Se propone AGREGAR una tercera categoría a la lista permitida y acotar la
frase de prohibición:

> 3. **Conectores opcionales**, únicamente bajo TODAS estas condiciones:
>    1. **Apagados por defecto**: se encienden con una bandera de despliegue
>       explícita (patrón ADR-001); una instancia default no los carga, no los
>       menciona y no pide sus credenciales.
>    2. **Aislados tras un adaptador dedicado** con contrato público estable,
>       como el cliente Graph API y el adaptador LLM; el dominio no conoce al
>       proveedor.
>    3. **La instancia funciona completa sin ellos**: existe un camino sin
>       dependencia externa para la misma capacidad (p. ej. el conector
>       `enlace-fijo` de la agenda), y el fallo del proveedor degrada de forma
>       definida — NUNCA bloquea ni pierde la operación core (la cita se crea
>       con link pendiente; el mensaje se responde; el dato se guarda).
>    4. **Credenciales del propio negocio, cifradas en reposo** (Principio I):
>       cada instancia habla con SU cuenta del proveedor; jamás credenciales de
>       una plataforma central.
>    5. **Verificables apagados y encendidos**: la CI ejercita ambas
>       configuraciones y cada conector externo tiene mock con camino infeliz.
>
> La frase de prohibición pasa a: "PROHIBIDO como dependencia del núcleo (todo
> lo que el producto necesite para operar sin banderas): almacenamiento de
> objetos externo, email, billing y cualquier servicio de terceros. Un
> servicio de terceros solo puede entrar como conector opcional bajo las cinco
> condiciones anteriores."

**Bump**: MINOR (1.3.0 → 1.4.0) — expansión material de un principio. No
redefine nada de forma incompatible: una instancia default sigue cumpliendo
exactamente la promesa actual ("un VPS, un dominio, credenciales de Meta y un
token de OpenRouter. Nada más").

## Motivación

1. **El caso ya existe con otro nombre.** El canal de Instagram (014/ADR-001)
   entró como integración opcional detrás de `CHANNELS`; pasó constitucional
   porque Instagram es la misma Meta Graph API del canal permitido. El motor de
   agendamiento necesita Zoom y Google —proveedores nuevos— y el principio
   vigente no da ninguna vía, ni siquiera apagados por defecto. Sin enmienda,
   la única salida sería "cada quien su fork", que ADR-001 ya demostró
   insostenible (la rama `004-motor-agenda` quedó irrescatable en 26 días: 76
   commits atrás y migración colisionada).
2. **La soberanía que el principio protege no se toca.** El costo que la regla
   evita —"cada dependencia externa es un costo, un punto de fallo y una fuga
   de soberanía"— lo paga únicamente la instancia que enciende la bandera y
   pega SUS credenciales. La promesa "gratis y tuyo" del despliegue default
   queda intacta y ahora verificada por CI (condición 5).
3. **Es la ventaja competitiva declarada por el dueño**: que la comunidad pueda
   desarrollar los complementos faltantes exige que exista un lugar
   constitucional donde un complemento pueda vivir.

## Qué NO cambia

- Principios I, III–IX: íntegros.
- La lista del núcleo sigue cerrada: WhatsApp Cloud API + LLM por OpenRouter.
- Auth y base de datos self-hosted.
- El instalador default sigue necesitando exactamente lo mismo que hoy.

## Procedimiento

1. El responsable del proyecto aprueba o rechaza esta propuesta.
2. Si se aprueba: se edita `.specify/memory/constitution.md` con su Sync
   Impact Report (1.3.0 → 1.4.0), se propaga a `CLAUDE.md` (sección "Reglas de
   la constitución") y a las plantillas si aplica, ANTES de la primera línea de
   implementación de los conectores `zoom`/`google`.
3. Si se rechaza: el alcance de `015` se recorta a bandera + motor +
   `enlace-fijo` (ninguno viola el principio vigente) y los conectores externos
   quedan como especificación para forks.

## Resolución (2026-08-26)

Aprobada por el responsable del proyecto y aplicada el mismo día:
`.specify/memory/constitution.md` pasó a **1.4.0** (Principio II expandido con
la categoría de conectores opcionales y la frase de prohibición acotada al
núcleo) y la regla de Soberanía de `CLAUDE.md` quedó sincronizada. Los
conectores externos de la feature 015 (`zoom`, `google`) quedan
constitucionalmente habilitados bajo las cinco condiciones; el plan B de
recorte queda sin efecto.
