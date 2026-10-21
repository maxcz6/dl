import { asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sumable } from "@/lib/money";
import {
  bucketsDelPeriodo,
  comparable,
  rate,
  type FunnelStepDto,
  type LossReasonRowDto,
  type SalesBlockDto,
  type StageKind,
  type StageTimingDto,
} from "@/lib/analytics";
import { LOSS_REASON_LABEL, type LossReason } from "@/lib/types";
import type { ResolvedPeriod } from "@/server/analytics/period";
import { localDateExpr, notLabContact } from "@/server/analytics/shared";

/**
 * 019 — Bloque de ventas y embudo.
 *
 * Casi todo se agrega en SQL: traer los leads a Node para sumarlos aguanta 200
 * y se cae con 20 000, justo cuando el negocio crezca y la pantalla importe
 * más. La excepción es el desenlace de cada lead, que la base resuelve con un
 * DISTINCT ON y aquí solo se reparte en cubetas.
 *
 * Portado de Vocero Cloud sin el «dinero esperado»: necesita la probabilidad
 * de cierre del lead, una columna que el raíz no tiene (spec 019, D5).
 */
export async function salesBlock(
  organizationId: string,
  period: ResolvedPeriod,
  businessCurrency: string
): Promise<SalesBlockDto> {
  const { start, end, previousStart, previousEnd } = period;

  // El desenlace de cada lead se resuelve UNA vez y de ahí salen los
  // indicadores, la serie y los motivos de pérdida. Si cada bloque lo dedujera
  // por su cuenta podrían contradecirse entre sí en la misma pantalla.
  const [desenlaces, desenlacesPrev] = await Promise.all([
    desenlacesDelPeriodo(organizationId, start, end),
    desenlacesDelPeriodo(organizationId, previousStart, previousEnd),
  ]);
  const cerrados = clasificarCierres(desenlaces, businessCurrency);
  const cerradosPrev = clasificarCierres(desenlacesPrev, businessCurrency);

  const [nuevos, nuevosPrev, timeToWinDays, serie, embudo, tiempos, completeFrom, vivo] =
    await Promise.all([
      contarNuevos(organizationId, start, end),
      contarNuevos(organizationId, previousStart, previousEnd),
      diasHastaGanar(organizationId, cerrados.won),
      serieTemporal(organizationId, period, cerrados.won, businessCurrency),
      embudoCohorte(organizationId, start, end),
      tiemposPorEtapa(organizationId, start, end),
      primerEventoReal(organizationId),
      pipelineVivo(organizationId, businessCurrency),
    ]);

  const wonCount = cerrados.won.length;
  const lostCount = cerrados.lost.length;

  // Ticket promedio sobre los tratos que SÍ tienen monto en la moneda del
  // negocio: dividir entre todos los ganados castigaría el promedio con los
  // que nadie capturó.
  const avgTicketCents =
    cerrados.wonWithAmount > 0
      ? Math.round(cerrados.wonCents / cerrados.wonWithAmount)
      : null;

  return {
    period: period.dto,
    kpis: {
      newLeads: comparable(nuevos, nuevosPrev),
      won: comparable(wonCount, cerradosPrev.won.length),
      lost: comparable(lostCount, cerradosPrev.lost.length),
      wonCents: comparable(cerrados.wonCents, cerradosPrev.wonCents),
      winRate: rate(wonCount, wonCount + lostCount),
      avgTicketCents,
    },
    pipeline: vivo,
    series: serie,
    funnel: embudo,
    timing: tiempos,
    timeToWinDays,
    completeFrom,
    lossReasons: motivosDePerdida(desenlaces),
    // "Vacío" habla del PERIODO, no del tablero: el embudo de hoy casi siempre
    // tiene algo, y si contara un rango de 2020 nunca podría declararse vacío.
    empty: nuevos === 0 && wonCount === 0 && lostCount === 0,
  };
}

/** Prospectos que entraron: leads creados en el rango, sin los del Laboratorio. */
async function contarNuevos(
  organizationId: string,
  start: Date,
  end: Date
): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lt(schema.lead.createdAt, end),
        notLabContact(schema.lead.contactId)
      )
    );
  return rows[0]?.n ?? 0;
}

type Cierres = {
  won: string[];
  lost: string[];
  wonCents: number;
  wonWithAmount: number;
};

export type Desenlace = {
  leadId: string;
  kind: StageKind;
  lossReason: LossReason | null;
  amountCents: number | null;
  currency: string | null;
};

/**
 * Cómo terminó cada lead que se movió dentro del rango: su ÚLTIMO movimiento,
 * sea del tipo que sea.
 *
 * Mirar solo los eventos de cierre no alcanza. Sacar una tarjeta de Ganado y
 * devolverla al embudo deja un evento `open`, así que el último evento *de
 * cierre* seguiría diciendo "ganado" y el trato aparecería como venta —encima
 * del mismo dinero contado otra vez en "hoy en el embudo"—. Y un trato que se
 * gana, se saca y se vuelve a ganar deja dos eventos `won` del mismo lead, que
 * sumarían el monto dos veces. Con el desenlace único los dos casos
 * desaparecen.
 */
async function desenlacesDelPeriodo(
  organizationId: string,
  start: Date,
  end: Date
): Promise<Desenlace[]> {
  return getDb()
    .selectDistinctOn([schema.leadStageEvent.leadId], {
      leadId: schema.leadStageEvent.leadId,
      kind: schema.leadStageEvent.toStageKind,
      lossReason: schema.leadStageEvent.lossReason,
      amountCents: schema.lead.amountCents,
      currency: schema.lead.currency,
    })
    .from(schema.leadStageEvent)
    .innerJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        gte(schema.leadStageEvent.occurredAt, start),
        lt(schema.leadStageEvent.occurredAt, end),
        notLabContact(schema.leadStageEvent.contactId)
      )
    )
    .orderBy(
      schema.leadStageEvent.leadId,
      desc(schema.leadStageEvent.occurredAt),
      desc(schema.leadStageEvent.createdAt)
    );
}

/**
 * Tratos cerrados en el rango. Se cuenta el LEAD, no el evento.
 *
 * El dinero sale del monto ACTUAL del lead —no se guarda histórico del monto—,
 * y solo suma el que está en la moneda del negocio.
 */
export function clasificarCierres(
  desenlaces: Desenlace[],
  businessCurrency: string
): Cierres {
  const won: string[] = [];
  const lost: string[] = [];
  let wonCents = 0;
  let wonWithAmount = 0;

  for (const d of desenlaces) {
    // `open` = el lead volvió al embudo y no cerró nada en este rango.
    if (d.kind === "won") {
      won.push(d.leadId);
      if (sumable({ amountCents: d.amountCents, currency: d.currency }, businessCurrency)) {
        wonCents += d.amountCents!;
        wonWithAmount += 1;
      }
    } else if (d.kind === "lost") {
      lost.push(d.leadId);
    }
  }

  return { won, lost, wonCents, wonWithAmount };
}

/**
 * Días desde que entró el prospecto hasta que se ganó. Solo con eventos
 * REALES: los sembrados por la migración traen `updated_at` como fecha, que
 * cualquier edición posterior pisó, y contaminarían el promedio.
 */
async function diasHastaGanar(
  organizationId: string,
  leadIds: string[]
): Promise<number | null> {
  if (leadIds.length === 0) return null;
  const rows = await getDb()
    .select({
      dias: sql<number | null>`avg(extract(epoch from (${schema.leadStageEvent.occurredAt} - ${schema.lead.createdAt})) / 86400)::float`,
    })
    .from(schema.leadStageEvent)
    .innerJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        inArray(schema.leadStageEvent.leadId, leadIds),
        eq(schema.leadStageEvent.toStageKind, "won"),
        eq(schema.leadStageEvent.approximate, false)
      )
    );
  const dias = rows[0]?.dias;
  return dias === null || dias === undefined ? null : Math.round(dias * 10) / 10;
}

/**
 * Serie por día o por mes, cortada en la zona del negocio.
 *
 * `wonLeadIds` son los tratos que el periodo ya dio por ganados; la serie NO
 * vuelve a decidir quién ganó, solo reparte esos mismos en el calendario. Es lo
 * que mantiene la gráfica cuadrada con el indicador de arriba.
 */
async function serieTemporal(
  organizationId: string,
  period: ResolvedPeriod,
  wonLeadIds: string[],
  businessCurrency: string
): Promise<SalesBlockDto["series"]> {
  const db = getDb();
  const { start, end, timezone } = period;
  const porMes = period.dto.granularity === "month";

  const [nuevos, ganados] = await Promise.all([
    db
      .select({
        bucket: localDateExpr(schema.lead.createdAt, timezone, porMes),
        n: sql<number>`count(*)::int`,
      })
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          organizationId,
          gte(schema.lead.createdAt, start),
          lt(schema.lead.createdAt, end),
          notLabContact(schema.lead.contactId)
        )
      )
      // GROUP BY 1 (posición), no la expresión repetida: `localDateExpr` lleva
      // parámetros y Postgres vería dos expresiones distintas.
      .groupBy(sql`1`),
    // Se agrupa por (día, lead) y NO por día a secas: el dinero es del LEAD, y
    // sumarlo por evento haría que un trato ganado dos veces valiera el doble.
    // El colapso a un solo bucket por lead se hace abajo, en memoria, porque
    // los cierres de un rango son pocos por naturaleza.
    wonLeadIds.length === 0
      ? []
      : db
          .select({
            bucket: localDateExpr(schema.leadStageEvent.occurredAt, timezone, porMes),
            leadId: schema.leadStageEvent.leadId,
            lastAt: sql<number>`extract(epoch from max(${schema.leadStageEvent.occurredAt}))::float`,
            cents: sql<number>`coalesce(max(case when ${schema.lead.amountCents} is not null and coalesce(${schema.lead.currency}, ${businessCurrency}) = ${businessCurrency} then ${schema.lead.amountCents} else 0 end), 0)::int`,
          })
          .from(schema.leadStageEvent)
          .innerJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
          .where(
            scoped(
              schema.leadStageEvent.organizationId,
              organizationId,
              gte(schema.leadStageEvent.occurredAt, start),
              lt(schema.leadStageEvent.occurredAt, end),
              eq(schema.leadStageEvent.toStageKind, "won"),
              inArray(schema.leadStageEvent.leadId, wonLeadIds)
            )
          )
          .groupBy(sql`1`, schema.leadStageEvent.leadId),
  ]);

  const buckets = new Map<string, SalesBlockDto["series"][number]>();
  for (const r of nuevos) {
    buckets.set(r.bucket, { bucket: r.bucket, newLeads: r.n, won: 0, wonCents: 0 });
  }
  // Un lead ganado en dos días distintos del rango sigue siendo UN trato: se
  // queda en el bucket de su último cierre, que es lo que el indicador cuenta.
  const ultimoBucket = new Map<string, { bucket: string; cents: number; at: number }>();
  for (const r of ganados) {
    const at = Number(r.lastAt);
    const previo = ultimoBucket.get(r.leadId);
    if (previo && previo.at >= at) continue;
    ultimoBucket.set(r.leadId, { bucket: r.bucket, cents: r.cents, at });
  }
  for (const g of ultimoBucket.values()) {
    const prev = buckets.get(g.bucket) ?? {
      bucket: g.bucket,
      newLeads: 0,
      won: 0,
      wonCents: 0,
    };
    prev.won += 1;
    prev.wonCents += g.cents;
    buckets.set(g.bucket, prev);
  }
  // Cada cubeta del periodo, con cero donde no pasó nada.
  return bucketsDelPeriodo(period.dto).map(
    (bucket) => buckets.get(bucket) ?? { bucket, newLeads: 0, won: 0, wonCents: 0 }
  );
}

/**
 * Embudo de COHORTE: de los prospectos que ENTRARON en el rango, cuántos
 * llegaron a cada etapa (en cualquier momento, incluso después del rango).
 *
 * Es la pregunta del dueño —"de cada 100 que entran, cuántos cierran"— y no la
 * mezcla de cohortes que daría contar eventos sueltos.
 */
async function embudoCohorte(
  organizationId: string,
  start: Date,
  end: Date
): Promise<FunnelStepDto[]> {
  const db = getDb();

  const [etapas, alcanzadas] = await Promise.all([
    db
      .select()
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId))
      .orderBy(asc(schema.pipelineStage.position)),
    db
      .select({
        leadId: schema.leadStageEvent.leadId,
        maxOpenPos: sql<
          number | null
        >`max(case when ${schema.pipelineStage.kind} = 'open' then ${schema.pipelineStage.position} end)`,
        won: sql<number>`max(case when ${schema.leadStageEvent.toStageKind} = 'won' then 1 else 0 end)::int`,
      })
      .from(schema.leadStageEvent)
      .innerJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
      .leftJoin(
        schema.pipelineStage,
        eq(schema.pipelineStage.id, schema.leadStageEvent.toStageId)
      )
      .where(
        scoped(
          schema.leadStageEvent.organizationId,
          organizationId,
          gte(schema.lead.createdAt, start),
          lt(schema.lead.createdAt, end),
          notLabContact(schema.leadStageEvent.contactId)
        )
      )
      .groupBy(schema.leadStageEvent.leadId),
  ]);

  return armarEmbudo(etapas, alcanzadas);
}

/**
 * El embudo a partir de las etapas y de hasta dónde llegó cada lead. Aparte y
 * puro para poder probar sus reglas sin base.
 *
 * Un lead cuenta UNA vez por etapa aunque haya ido y vuelto, y el acumulado
 * solo corre sobre etapas ABIERTAS: si "Perdido" tuviera una posición alta, un
 * trato perdido aparecería como si hubiera pasado por todas.
 */
export function armarEmbudo(
  etapas: { id: string; name: string; kind: StageKind; position: number }[],
  alcanzadas: { maxOpenPos: number | null; won: number }[]
): FunnelStepDto[] {
  const abiertas = etapas.filter((s) => s.kind === "open");
  const ganada = etapas.find((s) => s.kind === "won");

  const pasos: FunnelStepDto[] = abiertas.map((s) => ({
    stageId: s.id,
    name: s.name,
    kind: s.kind,
    reached: alcanzadas.filter(
      (a) => a.maxOpenPos !== null && Number(a.maxOpenPos) >= s.position
    ).length,
    advanceRate: null,
  }));

  pasos.push({
    stageId: ganada?.id ?? null,
    name: ganada?.name ?? "Ganado",
    kind: "won",
    reached: alcanzadas.filter((a) => a.won === 1).length,
    advanceRate: null,
  });

  for (let i = 0; i < pasos.length - 1; i++) {
    pasos[i]!.advanceRate = rate(pasos[i + 1]!.reached, pasos[i]!.reached);
  }
  return pasos;
}

/**
 * Días que un lead pasa en cada etapa: diferencia entre un evento y el
 * siguiente del mismo lead, los dos dentro del rango y los dos REALES. Un tramo
 * medido contra una fecha sembrada por la migración no mide nada.
 */
async function tiemposPorEtapa(
  organizationId: string,
  start: Date,
  end: Date
): Promise<StageTimingDto[]> {
  const rows = await getDb()
    .select({
      stageId: schema.leadStageEvent.toStageId,
      name: schema.leadStageEvent.toStageName,
      dias: sql<
        number | null
      >`extract(epoch from (lead(${schema.leadStageEvent.occurredAt}) over (partition by ${schema.leadStageEvent.leadId} order by ${schema.leadStageEvent.occurredAt}) - ${schema.leadStageEvent.occurredAt})) / 86400`,
    })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        eq(schema.leadStageEvent.approximate, false),
        gte(schema.leadStageEvent.occurredAt, start),
        lt(schema.leadStageEvent.occurredAt, end),
        notLabContact(schema.leadStageEvent.contactId)
      )
    );

  const porEtapa = new Map<string, { stageId: string | null; name: string; dias: number[] }>();
  for (const r of rows) {
    if (r.dias === null) continue;
    const key = r.stageId ?? r.name;
    const bucket = porEtapa.get(key) ?? { stageId: r.stageId, name: r.name, dias: [] };
    bucket.dias.push(Number(r.dias));
    porEtapa.set(key, bucket);
  }

  return [...porEtapa.values()]
    .map((b) => ({
      stageId: b.stageId,
      name: b.name,
      avgDays: Math.round((b.dias.reduce((a, d) => a + d, 0) / b.dias.length) * 10) / 10,
      sample: b.dias.length,
    }))
    .sort((a, b) => (b.avgDays ?? 0) - (a.avgDays ?? 0));
}

/**
 * Desde cuándo los tiempos son completos: el primer evento observado de
 * verdad. Solo importa si hay eventos SEMBRADOS (la bitácora se instaló sobre
 * leads que ya existían); sin ellos el historial es completo desde el inicio y
 * no hay nada que advertir.
 */
async function primerEventoReal(organizationId: string): Promise<string | null> {
  const rows = await getDb()
    .select({
      at: sql<Date | null>`min(${schema.leadStageEvent.occurredAt}) filter (where ${schema.leadStageEvent.approximate} = false)`.mapWith(
        schema.leadStageEvent.occurredAt
      ),
      sembrados: sql<number>`count(*) filter (where ${schema.leadStageEvent.approximate} = true)::int`,
    })
    .from(schema.leadStageEvent)
    .where(scoped(schema.leadStageEvent.organizationId, organizationId));
  if (!rows[0]?.sembrados) return null;
  return rows[0].at?.toISOString() ?? null;
}

/**
 * Motivos de pérdida del periodo. Sale del MISMO desenlace que los
 * indicadores: la tabla no puede contar un trato que arriba no es perdido.
 */
export function motivosDePerdida(desenlaces: Desenlace[]): LossReasonRowDto[] {
  const acc = new Map<LossReason | "sin_registro", LossReasonRowDto>();

  for (const d of desenlaces) {
    if (d.kind !== "lost") continue;
    const reason = d.lossReason ?? "sin_registro";
    const row = acc.get(reason) ?? {
      reason,
      label: d.lossReason ? LOSS_REASON_LABEL[d.lossReason] : "Sin motivo registrado",
      count: 0,
    };
    row.count += 1;
    acc.set(reason, row);
  }

  return [...acc.values()].sort((a, b) => b.count - a.count);
}

/**
 * El embudo de HOY: dinero de las etapas abiertas en la moneda del negocio,
 * cuántos no tienen monto y cuántos están en otra moneda. Una sola pasada en
 * SQL; la suma va como `bigint` porque muchos montos de `integer` se salen de
 * `integer`.
 */
async function pipelineVivo(
  organizationId: string,
  businessCurrency: string
): Promise<SalesBlockDto["pipeline"]> {
  const mismaMoneda = sql`coalesce(${schema.lead.currency}, ${businessCurrency}) = ${businessCurrency}`;
  const rows = await getDb()
    .select({
      openCents: sql<string>`coalesce(sum(${schema.lead.amountCents}) filter (where ${schema.lead.amountCents} is not null and ${mismaMoneda}), 0)::bigint`,
      withoutAmount: sql<number>`count(*) filter (where ${schema.lead.amountCents} is null)::int`,
      otherCurrency: sql<number>`count(*) filter (where ${schema.lead.amountCents} is not null and not (${mismaMoneda}))::int`,
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.pipelineStage.kind, "open"),
        notLabContact(schema.lead.contactId)
      )
    );

  const r = rows[0];
  return {
    openCents: Number(r?.openCents ?? 0),
    withoutAmount: r?.withoutAmount ?? 0,
    otherCurrency: r?.otherCurrency ?? 0,
  };
}
