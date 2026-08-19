import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {};

export default withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    skipWaiting: true,
    runtimeCaching: [
      {
        urlPattern: /\.(?:js|css)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-resources",
        },
      },
      // Never cache navigations/documents or Supabase API calls — this app
      // runs on shared branch devices, and caching authenticated HTML or
      // API responses risks showing one staff member's page/data to the
      // next person on the same device after sign-out.
      {
        urlPattern: ({ request, url }) =>
          request.mode !== "navigate" &&
          request.destination !== "document" &&
          !url.hostname.endsWith(".supabase.co"),
        handler: "NetworkFirst",
        options: {
          cacheName: "offlineCache",
          expiration: {
            maxEntries: 200,
          },
        },
      },
    ],
  },
})(nextConfig);
