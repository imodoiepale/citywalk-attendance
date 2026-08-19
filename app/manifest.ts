import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Citywalk Attendance",
    short_name: "Attendance",
    description: "Clock in and out, track shifts and hours across Citywalk branches",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0D10",
    theme_color: "#0B0D10",
    orientation: "portrait",
    icons: [
      {
        src: "/logo-mark.png",
        sizes: "any",
        type: "image/png",
        purpose: "any"
      }
    ],
    prefer_related_applications: false
  }
}
