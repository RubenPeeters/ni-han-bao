import { CurrentDocsNav, DocsNav } from "@/components/docs-nav";
import { Suspense, type ReactNode } from "react";

export const metadata = {
  title: "Docs · ni han bao",
  description: "How to add ni han bao to your server, use it, and every command it has.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
      <Suspense fallback={<DocsNav pathname={null} />}>
        <CurrentDocsNav />
      </Suspense>
      <article className="flex min-w-0 flex-1 flex-col gap-4">{children}</article>
    </div>
  );
}
