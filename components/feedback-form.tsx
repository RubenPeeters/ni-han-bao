"use client";

import { sendSiteFeedback } from "@/app/feedback/actions";
import { Options } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DESCRIPTION_MAX, FEEDBACK_KINDS, TITLE_MAX } from "@/bot/src/feedback";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";

const field = "flex flex-col gap-2 text-sm font-medium";

/** /feedback's form: idea or problem, a title and a description, with the page the member came from. */
export function FeedbackForm({ from }: { from: string | null }) {
  const [state, submit, pending] = useActionState(sendSiteFeedback, null);
  if (state?.sent) {
    return (
      <p role="status" className="text-sm [overflow-wrap:anywhere]">
        {state.message}
      </p>
    );
  }
  return (
    <form action={submit} className="flex flex-col gap-4">
      {from && <input type="hidden" name="from" value={from} />}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-sm font-medium">Idea or problem?</legend>
        <Options name="kind" options={FEEDBACK_KINDS} value="feature" />
      </fieldset>
      <label className={field}>
        Title
        <Input name="title" required maxLength={TITLE_MAX} className="h-11 font-normal" />
      </label>
      <label className={field}>
        Description
        <textarea
          name="description"
          required
          maxLength={DESCRIPTION_MAX}
          rows={6}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? "Sending…" : "Send"}
        </Button>
        {state && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** The footer's link, carrying the page it was clicked on. */
export function FeedbackLink() {
  const pathname = usePathname();
  const href = pathname && pathname !== "/feedback" ? `/feedback?from=${encodeURIComponent(pathname)}` : "/feedback";
  return (
    <Link href={href} className="hover:text-foreground">
      Feedback
    </Link>
  );
}
