import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";
import { locales } from "@/i18n/config";
import { services } from "@/lib/services-data";

const STATIC_ROUTES = ["", "/privacy", "/terms"] as const;
const SERVICE_UMBRELLA_ROUTES = [
  "/services/web-foundation",
  "/services/ai-departments",
  "/services/integration-control",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  // Static + locale routes
  for (const route of STATIC_ROUTES) {
    for (const locale of locales) {
      entries.push({
        url: `${siteConfig.url}/${locale}${route}`,
        lastModified: now,
        changeFrequency: route === "" ? "weekly" : "monthly",
        priority: route === "" ? 1 : 0.4,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [l, `${siteConfig.url}/${l}${route}`]),
          ),
        },
      });
    }
  }

  // Umbrella service subpages (Web Foundation, AI Departments, Integration & Control)
  for (const route of SERVICE_UMBRELLA_ROUTES) {
    for (const locale of locales) {
      entries.push({
        url: `${siteConfig.url}/${locale}${route}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.9,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [l, `${siteConfig.url}/${l}${route}`]),
          ),
        },
      });
    }
  }

  // Legacy individual service detail pages (kept for crawlers; lower priority)
  for (const service of services) {
    for (const locale of locales) {
      entries.push({
        url: `${siteConfig.url}/${locale}/services/${service.slug}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.6,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [
              l,
              `${siteConfig.url}/${l}/services/${service.slug}`,
            ]),
          ),
        },
      });
    }
  }

  return entries;
}
