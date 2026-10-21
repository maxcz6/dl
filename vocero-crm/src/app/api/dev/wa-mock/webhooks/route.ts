import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Lo que el CRM le ha registrado a «Meta»: la suscripción de cada WABA (con su
 * override, si alguien lo puso) y el override de webhook de cada número. Para
 * que un self-test compruebe que guardar la conexión dejó el webhook puesto, y
 * que desconectar lo quitó, sin mirar dentro del CRM.
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const { wabaSubscriptions, phoneWebhooks } = getWaMockState();
  return Response.json({ wabaSubscriptions, phoneWebhooks });
}
