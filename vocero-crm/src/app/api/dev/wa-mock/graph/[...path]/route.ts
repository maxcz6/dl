import { mockGuard } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import {
  getWaMockState,
  nextN,
  nextOutboundWamid,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

/**
 * Imitación de la Graph API (contrato mocks.md). El cliente real apunta aquí
 * cuando META_GRAPH_BASE_URL = <app>/api/dev/wa-mock/graph — el código de
 * producción no sabe que habla con un mock.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

/** 016 — Catálogo cerrado de Meta para `business_messaging` (mismo que el real). */
const CAPI_EVENT_NAMES = new Set([
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "CartAbandoned",
  "RatingProvided",
  "ReviewProvided",
]);

/** La app de Meta "dueña" del token en el mock (la que queda suscrita). */
const MOCK_APP = {
  id: "mock-app",
  name: "App de prueba Vocero",
  link: "https://www.facebook.com/games/?app_id=mock-app",
};

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function invalidTokenResponse(): Response {
  return Response.json(
    {
      error: {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
        fbtrace_id: "mock",
      },
    },
    { status: 401 }
  );
}

/**
 * Tokens con los que el mock imita dos rechazos reales de Meta al registrar
 * el webhook: sin `whatsapp_business_management` (código 200) y una app sin
 * callback URL propia (el GET de `webhook_configuration` no trae
 * `application`).
 */
const SIN_GESTION = "-sin-gestion";
const SIN_WEBHOOK_DE_APP = "-sin-app";

function permissionErrorResponse(): Response {
  return Response.json(
    {
      error: {
        message: "(#200) Permissions error",
        type: "OAuthException",
        code: 200,
        fbtrace_id: "mock",
      },
    },
    { status: 403 }
  );
}

function callbackVerificationFailed(failure: string): Response {
  return Response.json(
    {
      error: {
        message: `(#2200) Callback verification failed with the following errors: ${failure}`,
        type: "OAuthException",
        code: 2200,
        fbtrace_id: "mock",
      },
    },
    { status: 400 }
  );
}

/**
 * Meta verifica el callback ANTES de aceptar un override: le hace el mismo
 * GET de suscripción que al configurarlo en el panel, y si no devuelve el
 * challenge, rechaza con 2200. El mock lo hace de verdad contra la URL, así
 * un verify token que no casa con la ruta no pasa en verde.
 *
 * Si la URL es la de esta misma instancia (`APP_BASE_URL`), se le habla por
 * loopback, como hace `deliverToWebhook`: el dominio público puede no
 * resolver desde dentro del proceso y lo que se prueba es la ruta y el token.
 */
async function callbackVerificationError(
  uri: string,
  verifyToken: string
): Promise<string | null> {
  const challenge = String(nextN() * 7919);
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "Invalid URL";
  }
  const own = getEnv().APP_BASE_URL.replace(/\/$/, "");
  if (url.origin === own) {
    url = new URL(`http://127.0.0.1:${process.env.PORT ?? "3000"}${url.pathname}${url.search}`);
  }
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.challenge", challenge);
  url.searchParams.set("hub.verify_token", verifyToken);
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (res.status === 200 && text === challenge) return null;
    return `HTTP Status Code = ${res.status}; the challenge did not match`;
  } catch {
    return "Couldn't connect to server";
  }
}

/** Un teléfono de Meta es solo dígitos; un BSUID lleva prefijo y punto. */
function esSoloDigitos(valor: string): boolean {
  return /^[0-9]+$/.test(valor);
}

/** Quita el segmento de versión (v25.0/...) si viene en la ruta. */
function normalizePath(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // GET {wabaId}/message_templates → lista para el sync
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    return Response.json({
      data: state.templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components ?? [{ type: "BODY", text: t.body }],
      })),
    });
  }

  // GET {wabaId}/subscribed_apps → la app suscrita y, si lo hay, su override
  // de callback. Misma forma que Meta; sin suscripción, `data` vacío.
  if (path.length === 2 && path[1] === "subscribed_apps") {
    const sub = getWaMockState().wabaSubscriptions[path[0]!];
    return Response.json({
      data: sub
        ? [
            {
              whatsapp_business_api_data: MOCK_APP,
              ...(sub.overrideCallbackUri
                ? { override_callback_uri: sub.overrideCallbackUri }
                : {}),
            },
          ]
        : [],
    });
  }

  // GET {mediaId} (ids "media...") → metadata de adjunto (media proxy del bot)
  if (path.length === 1 && path[0]!.startsWith("media")) {
    const origin = new URL(req.url).origin;
    return Response.json({
      id: path[0],
      mime_type: path[0]!.includes("pdf") ? "application/pdf" : "image/jpeg",
      file_size: 13,
      url: `${origin}/api/dev/wa-mock/media-file/${path[0]}`,
    });
  }

  // 017 — GET {psid}?fields=first_name,last_name → perfil de quien escribe
  // por Messenger (la ingesta lo consulta la primera vez que ve un PSID).
  const fields = new URL(req.url).searchParams.get("fields") ?? "";

  // GET {phoneNumberId}?fields=webhook_configuration → el override vigente
  // del número y la callback URL de la app (ausente con un token "-sin-app").
  if (path.length === 1 && fields.includes("webhook_configuration")) {
    const override = getWaMockState().phoneWebhooks[path[0]!];
    return Response.json({
      webhook_configuration: {
        ...(override ? { phone_number: override } : {}),
        ...(token.endsWith(SIN_WEBHOOK_DE_APP)
          ? {}
          : { application: "https://app-de-meta.mock/webhook" }),
      },
      id: path[0],
    });
  }

  if (path.length === 1 && fields.includes("first_name")) {
    return Response.json({
      id: path[0],
      first_name: "Cliente",
      last_name: "de Messenger",
    });
  }

  // 017 — GET {pageId}?fields=id,name → validación de la página de Facebook
  if (path.length === 1 && /(^|,)name(,|$)/.test(fields)) {
    return Response.json({ id: path[0], name: "Página de prueba Vocero" });
  }

  // GET {phoneNumberId}?fields=... → validación del wizard
  if (path.length === 1) {
    return Response.json({
      display_phone_number: "+52 55 0000 0000",
      verified_name: "Número de prueba Vocero",
      id: path[0],
    });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // POST {phoneNumberId}/media (multipart, 008) → id de media subido.
  // Va ANTES del parseo JSON: el body es form-data.
  if (path.length === 2 && path[1] === "media") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: { message: "missing file", type: "GraphMethodException", code: 100 } },
        { status: 400 }
      );
    }
    // El id arranca con "media" para que el GET de metadata lo resuelva.
    return Response.json({ id: `media-up-${nextN()}` });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 016 — POST {datasetId}/events: Conversions API. Imita las tres cosas que
  // de verdad importan del endpoint real: el catálogo cerrado de nombres, la
  // exigencia del ctwa_clid, y —sobre todo— que Meta puede responder 200
  // DESCARTANDO el evento. Los datasets terminados en "-fail" reproducen eso
  // último, que es el modo de fallo que nadie ve venir.
  if (path.length === 2 && path[1] === "events") {
    const state = getWaMockState();
    const events = Array.isArray(body.data)
      ? (body.data as Record<string, unknown>[])
      : [];
    const event = events[0];
    const eventName = String(event?.event_name ?? "");
    const userData = (event?.user_data ?? {}) as Record<string, unknown>;
    const ctwaClid = userData.ctwa_clid ? String(userData.ctwa_clid) : null;

    if (!CAPI_EVENT_NAMES.has(eventName)) {
      return Response.json(
        {
          error: {
            message: `(#100) Invalid parameter: event_name ${eventName || "(vacío)"}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock-capi-badname",
          },
        },
        { status: 400 }
      );
    }
    if (!ctwaClid) {
      return Response.json(
        {
          error: {
            message: "Messaging Event Invalid Ctwa Clid",
            type: "GraphMethodException",
            code: 100,
            error_subcode: 2804087,
            fbtrace_id: "mock-capi-noclid",
          },
        },
        { status: 400 }
      );
    }

    const datasetId = path[0]!;
    state.capiEvents.push({
      n: nextN(),
      datasetId,
      eventName,
      ctwaClid,
      customData:
        (event?.custom_data as Record<string, unknown> | undefined) ?? null,
      body,
      at: new Date().toISOString(),
    });

    // El 200 mentiroso: recibido por HTTP, descartado por Meta.
    const received = datasetId.endsWith("-fail") ? 0 : 1;
    return Response.json({
      events_received: received,
      messages: [],
      fbtrace_id: `mock-capi-${state.capiEvents.length}`,
    });
  }

  // POST {phoneNumberId}/messages con status:"read" → typing/leído:
  // NO es un mensaje saliente — no contamina el outbox.
  if (path.length === 2 && path[1] === "messages" && body.status === "read") {
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/messages → registra en el outbox
  if (path.length === 2 && path[1] === "messages") {
    const state = getWaMockState();

    /**
     * Meta espera un TELEFONO en `to`. Un BSUID ahi devuelve 131026 — «el
     * destinatario no puede recibir mensajes» — y el mock lo replica.
     *
     * Sin esto, mandar el BSUID en el campo equivocado pasaba en verde aqui y
     * fallaba en produccion, que es exactamente lo que ocurrio. El BSUID va
     * en `recipient`, con `recipient_type: "individual"`.
     */
    const destino = body.to as string | undefined;
    if (destino && !esSoloDigitos(destino)) {
      return Response.json(
        {
          error: {
            message:
              "(#131026) Message undeliverable: recipient is not a valid WhatsApp user",
            code: 131026,
            type: "OAuthException",
          },
        },
        { status: 400 }
      );
    }
    // Meta responde 132000 si los parámetros no cuadran con las {{n}} de la
    // plantilla aprobada. El mock lo replica para que un desfase no pase.
    if (body.type === "template") {
      const tplSend = body.template as
        | {
            name?: string;
            components?: { type?: string; parameters?: unknown[] }[];
          }
        | undefined;
      const known = state.templates.find((t) => t.name === tplSend?.name);
      if (known) {
        const expected = [...known.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce(
          (max, m) => Math.max(max, Number(m[1])),
          0
        );
        const got =
          tplSend?.components?.find(
            (c) => (c.type ?? "").toLowerCase() === "body"
          )?.parameters?.length ?? 0;
        if (expected !== got) {
          return Response.json(
            {
              error: {
                message: `(#132000) Number of parameters does not match the expected number of params: expected ${expected}, got ${got}`,
                type: "OAuthException",
                code: 132000,
                fbtrace_id: "mock",
              },
            },
            { status: 400 }
          );
        }
      }
    }
    const n = nextN();
    const waMessageId = nextOutboundWamid();
    state.outbox.push({
      n,
      waMessageId,
      phoneNumberId: path[0]!,
      to: String(body.to ?? ""),
      // Se guarda aparte para que un self-test pueda comprobar EN QUE CAMPO
      // viajo el destinatario, que es de lo que dependia el fallo.
      ...(body.recipient ? { recipient: String(body.recipient) } : {}),
      type: String(body.type ?? "text"),
      body,
      at: new Date().toISOString(),
    });
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: waMessageId }],
    });
  }

  // POST {wabaId}/message_templates → alta de plantilla (queda PENDING)
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    const components = (body.components ?? []) as {
      type?: string;
      text?: string;
      example?: { body_text?: string[][] };
    }[];
    const bodyComponent = components.find(
      (c) => (c.type ?? "").toUpperCase() === "BODY"
    );
    // Meta valida que haya un ejemplo por cada {{n}} del cuerpo: sin esto el
    // mock aceptaría plantillas que producción rechaza (error 100).
    const highestVar = [
      ...(bodyComponent?.text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g),
    ].reduce((max, m) => Math.max(max, Number(m[1])), 0);
    const examples = bodyComponent?.example?.body_text?.[0] ?? [];
    if (highestVar !== examples.length) {
      return Response.json(
        {
          error: {
            message: `Invalid parameter: expected ${highestVar} example value(s) for the body, got ${examples.length}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    const tpl: MockTemplate = {
      id: `tplmock_${nextN()}`,
      name: String(body.name ?? ""),
      language: String(body.language ?? "es_MX"),
      category: String(body.category ?? "UTILITY"),
      status: "PENDING",
      body: bodyComponent?.text ?? "",
      components,
    };
    state.templates.push(tpl);
    return Response.json({ id: tpl.id, status: "PENDING", category: tpl.category });
  }

  // POST {wabaId}/subscribed_apps → suscribe la app. Como en Meta, el override
  // de callback se fija mandándolo en el cuerpo y un POST SIN él lo BORRA
  // ("Delete WABA alternate callback"): un CRM que re-suscribe a ciegas
  // desconecta aquí al cerebro externo igual que en producción.
  if (path.length === 2 && path[1] === "subscribed_apps") {
    if (token.endsWith(SIN_GESTION)) return permissionErrorResponse();
    const uri =
      typeof body.override_callback_uri === "string"
        ? body.override_callback_uri.trim()
        : "";
    getWaMockState().wabaSubscriptions[path[0]!] = {
      overrideCallbackUri: uri || null,
    };
    return Response.json({ success: true });
  }

  // POST {phoneNumberId} con webhook_configuration → override del NÚMERO, el
  // que el CRM registra al guardar la conexión. Como en Meta: exige el
  // permiso de gestión, verifica el callback (handshake) antes de aceptarlo y
  // una cadena vacía lo quita.
  if (path.length === 1 && body.webhook_configuration) {
    if (token.endsWith(SIN_GESTION)) return permissionErrorResponse();
    const config = body.webhook_configuration as {
      override_callback_uri?: string;
      verify_token?: string;
    };
    const state = getWaMockState();
    const uri = config.override_callback_uri ?? "";
    if (!uri) {
      delete state.phoneWebhooks[path[0]!];
      return Response.json({ success: true });
    }
    const failure = await callbackVerificationError(uri, config.verify_token ?? "");
    if (failure) return callbackVerificationFailed(failure);
    state.phoneWebhooks[path[0]!] = uri;
    return Response.json({ success: true });
  }

  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  await ctx.params;
  return Response.json({ success: true });
}
