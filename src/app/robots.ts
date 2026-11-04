import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Only block paths crawlers should never fetch. Internal pages are kept out of the
 * index with a `noindex` robots meta tag instead. Blocking them here would stop
 * Google from ever seeing that tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/seethrough-admin"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
