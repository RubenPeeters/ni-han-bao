import { FeedbackForm } from "@/components/feedback-form";
import { LogInPrompt } from "@/components/server-picker";
import { PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Feedback · nexus",
  description: "An idea or a problem? Tell the people who make nexus. Also with /feedback in Discord.",
};

const LOG_IN = "Log in to send feedback.";

export default function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  return (
    <>
      <PageHeader title="Feedback" description={metadata.description} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <Feedback searchParams={searchParams} />
        </Suspense>
      ) : (
        <LogInPrompt text={LOG_IN} />
      )}
    </>
  );
}

async function Feedback({ searchParams }: Pick<PageProps<"/feedback">, "searchParams">) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const { from } = await searchParams;
  return (
    <section className="card flex min-w-0 flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        It becomes an issue on GitHub with your Discord name{typeof from === "string" ? " and the page you came from" : ""}.
      </p>
      <FeedbackForm from={typeof from === "string" ? from : null} />
    </section>
  );
}
