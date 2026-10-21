import { mockGuard } from "@/lib/dev-guard";
import { aiMockAuthFailure, aiMockModels } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

/** `GET /v1/models` del ai-mock, con la misma forma que OpenRouter/OpenAI. */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const rechazo = aiMockAuthFailure(req.headers.get("authorization"));
  if (rechazo) return Response.json(rechazo.body, { status: rechazo.status });

  return Response.json({ data: aiMockModels() });
}
