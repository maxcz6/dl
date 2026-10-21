import { apiError, withAuth } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { adsBlock } from "@/server/analytics/ads";

export const dynamic = "force-dynamic";

/**
 * 019 — De dónde llegan: conversaciones, prospectos y ventas por origen y por
 * anuncio. Solo conteos: sin gasto, sin costo, sin retorno (spec 019, D1-D2).
 */
export const GET = withAuth(async (session, req: Request) => {
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await adsBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});
