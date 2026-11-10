import type { Metadata } from "next";

/** Production origin. Every canonical, sitemap and social URL is built from this. */
export const SITE_URL = "https://seethroughus.com";
export const SITE_NAME = "SeeThrough";
export const SITE_TAGLINE = "The AI tutor that draws while it explains";
export const SITE_DESCRIPTION =
  "SeeThrough is a visual AI tutor and study tool. Ask any question by voice or text and it draws the answer on a whiteboard while it explains, with diagrams, system maps and 3D.";

/** Routes we want in search results (and in sitemap.xml). Keep in sync with public products. */
export const INDEXABLE_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/smart-tutor", priority: 0.9, changeFrequency: "weekly" },
  { path: "/news", priority: 0.9, changeFrequency: "daily" },
  { path: "/lessons", priority: 0.8, changeFrequency: "weekly" },
  { path: "/system-design", priority: 0.8, changeFrequency: "weekly" },
  { path: "/vibe-coder", priority: 0.7, changeFrequency: "monthly" },
  { path: "/browser", priority: 0.7, changeFrequency: "monthly" },
] as const;

/** For internal, experimental, retired or per-user pages: keep them out of the index. */
export const NO_INDEX: Metadata["robots"] = { index: false, follow: true };

/**
 * Metadata for an indexable page. Sets the canonical URL and repeats the title and
 * description into Open Graph and Twitter, since a page-level `openGraph` replaces the
 * root one wholesale (shallow merge). Social images come from the root
 * opengraph-image / twitter-image files.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const socialTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      title: socialTitle,
      description,
      locale: "en_US",
      images: [{ ...SOCIAL_IMAGE, url: "/opengraph-image" }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [{ ...SOCIAL_IMAGE, url: "/twitter-image" }],
    },
  };
}

/** Matches src/app/opengraph-image.tsx; repeated here because page-level openGraph drops the file-based image. */
const SOCIAL_IMAGE = {
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} – ${SITE_TAGLINE}`,
};

/** Serialize JSON-LD safely for a <script> tag (escapes `<` per Next.js guidance). */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}
