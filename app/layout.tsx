import type { Metadata } from "next";
import { Cormorant_Garamond, Crimson_Pro } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { BotStatusDot } from "@/components/bot-status";
import { MainNav, SiteNav } from "@/components/site-nav";
import { hasEnvVars, RIOT_DISCLAIMER } from "@/lib/utils";
import "./globals.css";

// Link previews need absolute image URLs that unfurlers can fetch. VERCEL_URL is the
// per-deployment host, which Vercel's deployment protection hides; the production one is not.
const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const defaultUrl = host ? `https://${host}` : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "ni han bao",
  description: "A Discord bot that counts messages, emoji and voice time, and shows the stats.",
  openGraph: { siteName: "ni han bao", type: "website" },
  twitter: { card: "summary_large_image" },
};

// Vercel Web Analytics, cookieless. The script is served by Vercel itself, so it is only
// added in production; user ids are cut from the URLs it reports, server ids are kept for
// the "servers with a visit per week" metric (README).
const analytics =
  process.env.VERCEL_ENV === "production"
    ? `window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.va("beforeSend",function(e){return Object.assign({},e,{url:e.url.replace(/\\/member\\/[^/?#]+/,"/member/[userId]").replace(/\\/u\\/[^/?#]+/,"/u/[userId]")})});`
    : null;

const heading = Cormorant_Garamond({
  variable: "--font-heading",
  weight: ["600", "700"],
  display: "swap",
  subsets: ["latin"],
});

const body = Crimson_Pro({
  variable: "--font-body",
  weight: ["400", "600"],
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${heading.variable} ${body.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-5 py-6">
            {/* On a phone the tabs get their own row: with Docs they no longer fit beside Log in. */}
            <header className="flex flex-wrap items-center gap-2 border-b pb-4">
              <Link
                href="/"
                className="whitespace-nowrap rounded-md text-lg font-semibold font-heading transition-colors hover:text-gold active:text-gold/80"
              >
                ni han bao
              </Link>
              <div className="order-last -ml-3 w-full sm:order-none sm:ml-0 sm:w-auto">
                <Suspense fallback={<MainNav pathname={null} />}>
                  <SiteNav />
                </Suspense>
              </div>
              <div className="ml-auto flex items-center">
                <AuthButton />
              </div>
            </header>
            <main className="flex flex-1 flex-col gap-8">{children}</main>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
              <span className="flex gap-3">
                <span>made by forge</span>
                <Link href="/about" className="hover:text-foreground">
                  About &amp; privacy
                </Link>
                <Link href="/terms" className="hover:text-foreground">
                  Terms
                </Link>
              </span>
              {hasEnvVars && (
                <Suspense fallback={<span>Bot status…</span>}>
                  <BotStatusDot />
                </Suspense>
              )}
              <p className="basis-full">{RIOT_DISCLAIMER}</p>
            </footer>
          </div>
        </ThemeProvider>
        {analytics && (
          <>
            <script dangerouslySetInnerHTML={{ __html: analytics }} />
            <script defer src="/_vercel/insights/script.js" />
          </>
        )}
      </body>
    </html>
  );
}
