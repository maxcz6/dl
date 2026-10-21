"use client";

import type { SalesBlockDto } from "@/lib/analytics";
import { formatMoneyCents } from "@/lib/money";
import { Funnel } from "./funnel";
import { Section, Subhead } from "./section";
import { RateCard, StatCard } from "./stat-card";
import { TimeBars } from "./time-bars";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** 019 — Ventas: los indicadores, la serie, el embudo y las pérdidas. */
export function SalesSection({
  data,
  loading,
  error,
  currency,
}: {
  data: SalesBlockDto | null;
  loading: boolean;
  error: string | null;
  currency: string;
}) {
  const money = (c: number | null) => formatMoneyCents(c, currency) ?? "—";
  return (
    <Section
      id="ventas"
      title="Ventas"
      hint="Lo que entró, lo que se cerró y dónde se atoran los tratos."
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data?.empty}
      emptyText="No hay prospectos ni cierres en este periodo. Prueba con un rango más amplio."
    >
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Prospectos nuevos"
              value={String(data.kpis.newLeads.current)}
              compare={data.kpis.newLeads}
            />
            <StatCard
              label="Tratos ganados"
              value={String(data.kpis.won.current)}
              compare={data.kpis.won}
            />
            <StatCard
              label="Dinero ganado"
              value={money(data.kpis.wonCents.current)}
              compare={data.kpis.wonCents}
            />
            <StatCard
              label="Tratos perdidos"
              value={String(data.kpis.lost.current)}
              compare={data.kpis.lost}
              inverted
            />
            <RateCard
              label="Tasa de cierre"
              rate={data.kpis.winRate}
              unit="tratos cerrados"
            />
            <StatCard
              label="Ticket promedio"
              value={money(data.kpis.avgTicketCents)}
              hint={
                data.kpis.avgTicketCents === null
                  ? "ningún trato ganado con monto"
                  : undefined
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TimeBars
              title="Prospectos nuevos"
              unit="prospectos"
              points={data.series.map((s) => ({ bucket: s.bucket, value: s.newLeads }))}
              format={(v) => String(v)}
            />
            <TimeBars
              title="Tratos ganados"
              unit="tratos ganados"
              points={data.series.map((s) => ({
                bucket: s.bucket,
                value: s.won,
                detail: s.wonCents > 0 ? money(s.wonCents) : undefined,
              }))}
              format={(v) => String(v)}
              emptyText="Ningún trato ganado en el periodo."
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <Subhead>Embudo de los que entraron en este periodo</Subhead>
              <Funnel steps={data.funnel} />
            </div>

            <div className="space-y-6">
              <div>
                <Subhead>Dónde se atoran</Subhead>
                {data.timing.length === 0 ? (
                  <p className="text-sm text-text-3">
                    Todavía no hay movimientos suficientes para medir tiempos.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">Etapa</th>
                        <th scope="col">Días en promedio</th>
                        <th scope="col">Movimientos medidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.timing.map((t) => (
                        <tr key={t.stageId ?? t.name} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">{t.name}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {t.avgDays ?? "—"} días
                          </td>
                          <td className="w-24 py-1.5 text-right text-xs text-text-3 tabular-nums">
                            {t.sample} mov.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {data.timeToWinDays !== null && (
                  <p className="mt-2 text-xs text-text-3">
                    Del primer contacto al cierre:{" "}
                    <strong className="font-semibold text-foreground">
                      {data.timeToWinDays} días
                    </strong>{" "}
                    en promedio.
                  </p>
                )}
              </div>

              <div>
                <Subhead>Por qué se perdieron</Subhead>
                {data.lossReasons.length === 0 ? (
                  <p className="text-sm text-text-3">Ningún trato perdido en este periodo.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">Motivo</th>
                        <th scope="col">Tratos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lossReasons.map((r) => (
                        <tr key={r.reason} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">{r.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div>
            <Subhead>Hoy en el embudo</Subhead>
            <p className="-mt-1 mb-2 text-xs text-text-3">
              No depende del periodo: son los tratos abiertos en este momento.
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:max-w-xl">
              <StatCard label="Dinero en tratos abiertos" value={money(data.pipeline.openCents)} />
              <StatCard
                label="Tratos sin monto"
                value={String(data.pipeline.withoutAmount)}
                hint={data.pipeline.withoutAmount > 0 ? "no suman al dinero abierto" : undefined}
              />
            </div>
            {data.pipeline.otherCurrency > 0 && (
              <p className="mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-xs text-warning-text">
                {plural(data.pipeline.otherCurrency, "trato", "tratos")} con monto en otra
                moneda no {data.pipeline.otherCurrency === 1 ? "entra" : "entran"} en los
                totales: mezclar monedas daría una suma falsa.
              </p>
            )}
          </div>

          {data.completeFrom && (
            <p className="text-[11px] text-text-3">
              Los tiempos usan movimientos registrados desde el{" "}
              {new Date(data.completeFrom).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              . Lo anterior se sembró al instalar la bitácora de etapas y no se usa para
              medir duraciones.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
