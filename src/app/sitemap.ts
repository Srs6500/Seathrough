import type { MetadataRoute } from "next";
import { INDEXABLE_ROUTES, SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return INDEXABLE_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
