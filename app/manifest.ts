import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Аренда ТС",
    short_name: "Аренда ТС",
    description: "Расчёт аренды, счета, оплаты и расходы",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6f8",
    theme_color: "#0b2239",
    lang: "ru",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icons/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
