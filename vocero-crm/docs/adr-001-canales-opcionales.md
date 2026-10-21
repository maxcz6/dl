# ADR-001 — Los canales opcionales viven en main, apagados por bandera

**Estado**: aceptado · **Fecha**: 2026-08-25 · **Contexto**: feature 014 (canal de Instagram)

## El problema

Vocero debe seguir siendo una herramienta ligera: quien lo instala para un
negocio que solo vende por WhatsApp no debería ver pantallas, variables ni
conceptos de canales que no usa. Pero un cliente que sí quiere Instagram debe
poder tenerlo rápido, sin que su instancia se convierta en un fork.

## Lo que se descartó, y por qué

**Una skill que modifica el código fuente bajo demanda.** Es un parche contra
un blanco móvil: codifica formas exactas del código, así que cada refactor en
main la rompe sin que ningún CI lo note. Produce salidas distintas en cada
instalación, lo que hace irreproducibles los reportes de bugs. Y deja al
usuario con conflictos de merge en los archivos parcheados cada vez que
actualiza.

**Una rama por feature opcional.** El costo obvio es mantener cada rama
compatible con main; el que hunde es que las ramas tienen que ser compatibles
**entre ellas**. Dos features opcionales que tocan `send.ts` e `ingest.ts`
chocan entre sí, y la combinación que un usuario quiere es un artefacto que
nadie ha probado. Con 3 features opcionales hay 7 combinaciones posibles; con
5, treinta y una.

Y ambas comparten un problema sin solución limpia: **la cadena de migraciones
de Drizzle es lineal y hasheada**. Dos ramas que agregan un `0008_` no pueden
coexistir sin renumerar, lo que convierte el merge en algo que no es mecánico.

## La decisión

El código de todos los canales viaja en main. Lo que decide si un canal existe
para el usuario es la variable de entorno `CHANNELS` (default: `whatsapp`).

Con el canal apagado:

- `/api/settings/<canal>` responde 404
- `/api/webhooks/<canal>/*` responde 404
- la salida por ese canal falla con un error claro
- no se piden variables ni credenciales suyas

La migración se aplica **siempre**. Una columna con default y una tabla vacía
son inertes, y a cambio todas las instancias del mundo tienen exactamente la
misma estructura de base de datos: una sola cadena de migraciones, y bugs
reproducibles.

El concepto de "canal" en el núcleo no es "la feature multicanal": es modelar
bien. Un CRM de mensajería tiene canales aunque hoy solo uno esté habilitado.

## Lo que esto no resuelve

Las banderas no eliminan la combinatoria: con N banderas siguen existiendo 2^N
configuraciones y no se prueban todas. Lo que cambia es **dónde se paga**:

| | Ramas | Banderas |
|---|---|---|
| Quién resuelve el conflicto | cada usuario, en cada release | el autor, una vez, al mergear |
| Un refactor de `send.ts` | rompe N ramas en silencio | actualiza todos los caminos a la vez |
| Cadena de migraciones | una por rama, irreconciliables | una sola |
| Combinación no probada | build roto o merge imposible | un bug reproducible, en un artefacto que existe |

CI corre la suite con la bandera apagada y encendida. No cubre 2^N, cubre lo
que la gente usa — y con ramas no habría dónde poner esa prueba.

## Consecuencias

- El núcleo no puede saber las reglas de un canal concreto: las pregunta a
  `src/server/channels/capabilities.ts`. La ventana, las plantillas, el límite
  de texto y los acuses de entrega se declaran por canal.
- Agregar un canal es escribir su adaptador y declarar sus capacidades.
- main carga código que no todas las instancias usan. Es el costo aceptado; se
  paga igual desde el momento en que la feature debe existir y funcionar, y la
  alternativa es pagarlo en soporte a instancias irreproducibles.

## Cuándo revisar esta decisión

Cuando haya del orden de quince banderas, o cuando terceros necesiten publicar
canales sin pasar por el repo. Ahí toca extraer una interfaz de adaptador y
paquetes versionados. Construir eso para un solo canal opcional sería
adelantarse.

**Nota sobre "plugin"**: en Vocero significa *rápido de contribuir y de
encender*, no *cargable en runtime desde cualquier lado*. Código de terceros
corriendo en el proceso tendría acceso a la base y podría leer descifrados los
tokens de WhatsApp de todos los clientes. Ese modelo de amenaza es otro, y no
se abre esa puerta.
