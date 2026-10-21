# Guion E2E — Resultados: ventas, el agente, de dónde llegan y qué se cae

> Automatizado en `scripts/e2e-resultados.mjs` (`pnpm test:e2e:resultados`,
> app viva con los mocks). Spec: [019](../../specs/019-resultados/spec.md).
> Corre con la bandera `AGENDA` apagada o encendida: la lee del mismo entorno
> que la app.

La instancia puede traer datos de otros guiones, así que el guion toma una
foto de las cuatro secciones ANTES de sembrar y otra DESPUÉS, y compara la
diferencia. Las filas por anuncio sí son exactas: sus `source_id` son de la
corrida.

## Siembra (caminos reales)

Diez personas escriben por el webhook del wa-mock: tres desde el anuncio R1
(con creativo), una desde R2 (sin imagen), una desde una **publicación**, una
que pide un humano, dos orgánicas, una dada de alta a mano como «referido» que
luego escribe, y una que se lleva al periodo anterior. El agente contesta
(036: un cerebro por el despacho y `/api/bot/messages`; el CRM ya no trae
agente que conteste contra el ai-mock), y el que pide un humano se traspasa
por `POST /api/bot/handoff`. Por la API del pipeline: una venta de $12,000, un trato
perdido por precio, otro ganado-sacado-y-vuelto-a-ganar ($5,000), otro ganado
y devuelto al embudo, un monto de $3,000 en un trato abierto. Meta rechaza un
envío (130472). Por SQL, solo lo que el webhook no puede fabricar: fechas en
el pasado (un lead en silencio 8 días, una ventana por cerrarse, el periodo
anterior) y, con `AGENDA`, citas de cada desenlace más una de prueba.

## Camino verificado

1. Sin rango, las cuatro secciones responden 200 con los últimos 30 días en la
   zona del negocio. Un rango invertido, una fecha inventada, una que no
   existe (31 de febrero) o de varios años → **422 con mensaje**.
2. **Ventas**: +9 prospectos (+1 en el anterior), +2 ganados (el devuelto no
   cuenta; el ganado dos veces, una), +1 perdido, +$17,000.00 ganados, tasa de
   cierre con su denominador, «precio» +1, embudo (+9 en la primera etapa, +3
   llegaron a Ganado), hoy en el embudo (+$3,000 abiertos, +6 sin monto), una
   cubeta por día del periodo y la serie cuadra con los indicadores.
3. **Origen y anuncios**: +9 conversaciones (+1 en el anterior); «Anuncio»
   +4/+4/+2; la publicación cuenta como «Sin identificar», no como anuncio;
   lo capturado («Referido») manda; ni una llave de gasto, costo o retorno. R1
   = 3 conversaciones, 3 prospectos, 1 venta (33 % de 3, muestra chica), con
   titular e imagen servida por `/api/media`; R2 = 1/1/1 sin imagen; la
   publicación tiene su fila marcada `post`. El `ctwa_clid` no sale.
4. **El agente**: +9 conversaciones; «contestó el agente» sobre las 9 con
   mensaje del cliente; +9 primeras respuestas medidas (también la escalada,
   si el cerebro manda su aviso antes de traspasar: es respuesta con origen
   IA); +1 «El cliente pidió un humano»; la ficha se mide
   sobre los contactos nuevos. Sin `AGENDA`: `sessions: null`. Con `AGENDA`:
   +4 citas (la de prueba no cuenta), +1 realizada, +1 no llegó, +1 cancelada,
   asistencia sobre las 2 con desenlace.
5. **Qué se está cayendo**: +1 en silencio con sus $3,000 y 8 días; +1 mensaje
   que no llegó con el código de Meta; la ventana por cerrarse con ~3 h.
6. **El Laboratorio no existe para Resultados**: se corre el Laboratorio
   completo y se le inventa un lead a uno de sus contactos; ningún número de
   las cuatro secciones cambia.
7. `/results` carga con sesión y el menú lleva ahí; sin sesión, las cuatro
   rutas de analítica responden 401.

La responsividad de `/results` (sin recorte a lo ancho en teléfono, tableta y
escritorio) la cubre `scripts/e2e-responsive.mjs`.
