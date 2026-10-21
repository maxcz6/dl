import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { estadoIaDe, mensajeDeEstado } from "@/lib/ai/provider";

/**
 * ¿Hay que avisarle al dueño de que su agente no puede contestar?
 * (puerto de `aviso-ia` de Vocero Cloud, issue #85)
 *
 * El caso que esto cierra: una organización con el agente encendido y sin
 * proveedor de IA (o con la llave rechazada). El mensaje entra, el turno no
 * tiene con qué pensar y la conversación se queda en la bandeja. Desde fuera
 * se ve exactamente igual que un bot roto — y el único sitio donde se
 * explicaba era un recuadro dentro del panel de UN contacto.
 *
 * Se exige que el agente esté ENCENDIDO: sin IA y con el agente apagado no
 * hay nada que avisar. Lo que se señala es la contradicción.
 */
export type AvisoIa = { mensaje: string; accion: string } | null;

export async function avisoIaDe(organizationId: string): Promise<AvisoIa> {
  const estado = await estadoIaDe(organizationId);
  if (estado.activa) return null;

  const db = getDb();
  const filas = await db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!filas[0]?.enabled) return null;

  const mensaje = mensajeDeEstado(estado);
  if (!mensaje) return null;

  return {
    mensaje,
    // Sin configurar se va a pegar la llave; pausada, a revisar la conexión.
    // Las dos acaban en la misma pantalla, y decirlo evita el «¿y dónde?».
    accion:
      estado.motivo === "sin_configurar"
        ? "Configurar la IA"
        : "Revisar mi conexión",
  };
}
