import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { BotStatusDot } from "@/components/bot-status";
import { SiteNav } from "@/components/site-nav";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
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
// added in production; member ids are cut from the URLs it reports, server ids are kept for
// the "servers with a visit per week" metric (README).
const analytics =
  process.env.VERCEL_ENV === "production"
    ? `window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.va("beforeSend",function(e){return Object.assign({},e,{url:e.url.replace(/\\/member\\/[^/?#]+/,"/member/[userId]")})});`
    : null;

const geistSans = Geist({
  variable: "--font-geist-sans",
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
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-5 py-6">
            <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center">
              <div className="flex items-center justify-between sm:contents">
                <Link
                  href="/"
                  className="rounded-md text-lg font-semibold transition-colors hover:text-primary active:text-primary/80"
                >
                  ni han bao
                </Link>
                <div className="flex min-w-0 items-center gap-2 sm:order-last sm:ml-auto">
                  <AuthButton />
                  <ThemeSwitcher />
                </div>
              </div>
              {/* Server pages know their guildId only at request time; same height, so no jump. */}
              <Suspense fallback={<div className="h-8" />}>
                <SiteNav />
              </Suspense>
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
