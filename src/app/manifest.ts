import type { MetadataRoute } from "next";

/**
 * The web app manifest (served at /manifest.webmanifest): makes the app installable on a
 * phone, and registers it as a Share target so Android's Share menu lists it. Shared links
 * open /share (src/app/(app)/share/page.tsx).
 */
export default function manifest(): MetadataRoute.Manifest & { share_target: ShareTarget } {
  return {
    id: "/",
    name: "Recall Library",
    short_name: "Recall",
    description: "Remember what you read, watch and learn.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#2f5bd3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}

interface ShareTarget {
  action: string;
  method: "GET" | "POST";
  params: { title?: string; text?: string; url?: string };
}
