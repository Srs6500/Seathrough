import type { Metadata } from "next";
import { MarketingHome } from "@/components/site/MarketingHome";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  jsonLd,
  pageMetadata,
} from "@/lib/seo";

const HOME_TITLE = `${SITE_NAME} – ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  ...pageMetadata({ title: HOME_TITLE, description: SITE_DESCRIPTION, path: "/" }),
  title: { absolute: HOME_TITLE },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/SeeThrough_logo.png`,
      sameAs: [
        "https://www.youtube.com/@SeeThrough-g8k",
        "https://www.instagram.com/seethrough_io/",
        "https://www.tiktok.com/@seethrough737",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      publisher: { "@id": `${SITE_URL}/#organization` },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Voice AI tutor that explains out loud",
        "Draws diagrams on a whiteboard while it explains",
        "Physics figures and 3D models",
        "System design diagrams",
        "Explains the code in your GitHub repo",
      ],
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <MarketingHome />
    </>
  );
}
