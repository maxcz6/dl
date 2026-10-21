"use client";

import { useEffect, useState } from "react";
import type { ResolvedTheme } from "@/lib/theme";

/**
 * Tema realmente pintado, leído del atributo `data-theme` del <html>.
 * Para los pocos lugares que calculan color en JS (la vista previa de la
 * marca): el CSS solo no alcanza porque el color lo elige el usuario.
 *
 * Arranca en "light" y se corrige tras montar — en SSR no hay DOM que leer.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
