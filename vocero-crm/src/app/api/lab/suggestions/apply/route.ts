import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Aplica una sugerencia del juez con un click: crea la entrada P/R en el
 * knowledge base (FR-033). El front permite editarla antes de guardar; aquí
 * llega el texto final.
 */
const bodySchema = z.object({
  caseId: z.string().min(1),
  hallazgoIndex: z.number().int().min(0),
  pregunta: z.string().trim().min(1).max(500),
  respuesta: z.string().trim().min(1).max(4000),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const cases = await db
    .select({ id: schema.agentTestCase.id })
    .from(schema.agentTestCase)
    .where(
      scoped(
        schema.agentTestCase.organizationId,
        session.organizationId,
        eq(schema.agentTestCase.id, body.data.caseId)
      )
    )
    .limit(1);
  if (!cases[0]) return apiError(404, "not_found", "Caso no encontrado");

  const inserted = await db
    .insert(schema.kbEntry)
    .values({
      id: newId("kbEntry"),
      organizationId: session.organizationId,
      kind: "qa",
      question: body.data.pregunta,
      answer: body.data.respuesta,
    })
    .returning();
  return Response.json({ entry: inserted[0] }, { status: 201 });
});
