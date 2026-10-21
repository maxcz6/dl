import { notFound } from "next/navigation";
import { ChannelsClient } from "@/components/settings/channels-client";
import { isChannelEnabled } from "@/server/channels/enabled";
import { ZERNIO_CHANNELS } from "@/server/zernio/conexiones";

export const dynamic = "force-dynamic";

export default function ChannelsSettingsPage() {
  // Con WhatsApp solo esta pantalla no existe en esta instancia (ADR-001).
  if (!ZERNIO_CHANNELS.some((c) => isChannelEnabled(c))) notFound();
  return <ChannelsClient />;
}
