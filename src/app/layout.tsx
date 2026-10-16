import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Inter, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import { AuthProvider } from "@/components/AuthProvider";
import { QuestionAccessProvider } from "@/components/usage/QuestionAccess";
import { PageTransition } from "@/components/site/PageTransition";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Keep Newsreader queries simple — Turbopack breaks on multi-weight + italic
// google font maps ("queries have exactly one entry").
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: "400",
});

// Self-hosted so Vercel/Turbopack builds do not depend on fonts.gstatic.com
// (next/font/google Fraunces was failing deploy with misleading "module not found").
const fraunces = localFont({
  src: "./fonts/Fraunces-Variable.ttf",
  variable: "--font-fraunces",
  display: "swap",
  weight: "100 900",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SeeThrough",
  description:
    "Type a question. SeeThrough draws it while it explains: on a board, as a system map, or in 3D.",
  icons: {
    icon: [{ url: "/SeeThrough_logo.png", type: "image/png" }],
    apple: [{ url: "/SeeThrough_logo.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased",
        geist.variable,
        inter.variable,
        newsreader.variable,
        fraunces.variable,
        ibmPlexMono.variable,
      )}
    >
      <body className="flex min-h-full flex-col font-sans text-ink">
        <AuthProvider>
          <QuestionAccessProvider>
            <TooltipProvider delayDuration={200}>
              <PageTransition>{children}</PageTransition>
            </TooltipProvider>
          </QuestionAccessProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
