import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { Suspense } from "react";
import { BotStatusDot } from "@/components/bot-status";
import { SiteNav } from "@/components/site-nav";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Next.js and Supabase Starter Kit",
  description: "The fastest way to build apps with Next.js and Supabase",
};

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
                <div className="sm:order-last sm:ml-auto">
                  <ThemeSwitcher />
                </div>
              </div>
              <SiteNav />
            </header>
            <main className="flex flex-1 flex-col gap-8">{children}</main>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
              <span>made by forge</span>
              {hasEnvVars && (
                <Suspense fallback={<span>Bot status…</span>}>
                  <BotStatusDot />
                </Suspense>
              )}
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
