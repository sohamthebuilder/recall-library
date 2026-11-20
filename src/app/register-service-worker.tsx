"use client";

import { useEffect } from "react";

/** Registers public/sw.js so the app can be installed as a PWA. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
