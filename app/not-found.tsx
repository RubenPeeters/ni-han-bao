import { PageHeader } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata = { title: "Page not found · ni han bao" };

export default function NotFound() {
  return (
    <section className="flex flex-col items-start gap-6">
      <PageHeader title="Page not found" description="Nobody has said anything here. Not even once." />
      <Button asChild size="lg">
        <Link href="/">Back home</Link>
      </Button>
    </section>
  );
}
