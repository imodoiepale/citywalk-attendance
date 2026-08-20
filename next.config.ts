import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  experimental: {
    // Client-side router cache. Without it `dynamic` defaults to 0s, so every
    // return to an already-visited route re-renders on the server and pays the
    // ~370ms round trip to eu-west-1 again — which is what made moving between
    // screens feel like a reload.
    //
    // 15s, not the 30s example default: this app shows punch and leave data,
    // and stale numbers on a timesheet are worse than a short wait. Every
    // mutating action already calls revalidatePath, which evicts the entry, so
    // a stale read is only possible on a route nothing has changed.
    staleTimes: {
      dynamic: 15,
      static: 180,
    },
  },
};

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
