import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * 016 — Lo que el CRM le mandó a la Conversions API del mock. Existe para que
 * el self-test pueda afirmar sobre la FORMA del evento (nombre, ctwa_clid,
 * `custom_data`, valor en unidades) y no solo sobre "no hubo error".
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ capiEvents: getWaMockState().capiEvents });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  getWaMockState().capiEvents.length = 0;
  return Response.json({ cleared: true });
}
