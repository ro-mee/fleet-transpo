import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";

const manifest = {
  name: APP_NAME,
  short_name: APP_NAME,
  description: APP_DESCRIPTION,
  start_url: "/dashboard",
  display: "standalone",
  background_color: "#F8FAFC",
  theme_color: "#1E3A5F",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  ],
};

export async function GET() {
  return Response.json(manifest);
}
