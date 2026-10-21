import { BrandingClient } from "@/components/settings/branding-client";
import { FaviconCard } from "@/components/settings/favicon-card";
import { getBranding } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";
import { enabledChannels } from "@/server/channels/enabled";
import { navKicker } from "@/lib/channels";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // La marca se lee en el servidor para que la tarjeta del icono ya pinte la
  // vista previa correcta en el primer render, sin un parpadeo del generado al
  // subido mientras un fetch del cliente va y vuelve.
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);

  return (
    <div className="max-w-2xl space-y-6">
      {/* El logo viaja como prop: al subirlo o quitarlo, FaviconCard refresca
          la página y la vista previa de la marca lo sigue sin recargar. */}
      <BrandingClient
        favicon={branding.favicon}
        kicker={navKicker([...enabledChannels()])}
      />
      <FaviconCard branding={branding} />
    </div>
  );
}
