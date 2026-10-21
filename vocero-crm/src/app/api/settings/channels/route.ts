import { apiError, withAuth } from "@/lib/api";
import { channelsStatus } from "@/server/channels/status";
import {
  ZERNIO_CHANNELS,
  ensureWebhookForOrg,
} from "@/server/zernio/conexiones";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

/** Sin ningún canal social encendido esta superficie no existe (ADR-001). */
const haySociales = () => ZERNIO_CHANNELS.some((c) => isChannelEnabled(c));

/**
 * 023 — Estado de los canales: conexión, última entrada y, con Zernio, la
 * salud de la cuenta y del webhook. Ni la llave ni el secreto salen de aquí.
 */
export const GET = withAuth(async (session) => {
  if (!haySociales()) return channelDisabledResponse();
  return Response.json({
    channels: await channelsStatus(session.organizationId),
    canManage: session.role === "owner",
  });
});

/**
 * Da de alta o actualiza el webhook de esta instancia en Zernio, limitado a
 * las cuentas conectadas. Guardar una conexión ya lo hace; esto es para
 * reintentar si Zernio falló y para las instalaciones anteriores a la 1.6.
 */
export const POST = withAuth(async (session) => {
  if (!haySociales()) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar el webhook");
  }
  const r = await ensureWebhookForOrg(session.organizationId);
  if (!r.ok) {
    const status = r.code === "zernio_unavailable" ? 503 : r.code === "sin_conexiones" ? 409 : 422;
    return apiError(status, r.code, r.message);
  }
  return Response.json(r);
});
