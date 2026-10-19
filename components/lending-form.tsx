"use client";

import { setLending } from "@/app/u/[userId]/actions";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const DEFAULTS = [
  { value: "nothing", label: "Nothing until I mark cards", hint: "Set a count to lend on each card." },
  { value: "everything", label: "Everything I own", hint: "Except decks marked not for lending; a count on a card wins." },
];

/** "I lend cards": turning it on the first time asks which default applies. */
export function LendingForm({ lends, current }: { lends: boolean; current: string | null }) {
  const [on, setOn] = useState(lends);
  return (
    <form action={setLending} className="card flex flex-col gap-4">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="lends" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
        <span className="flex flex-col">
          <span className="text-lg font-semibold">I lend cards</span>
          <span className="text-muted-foreground">
            People in your servers see what you have to lend on a card&apos;s page, under Who has it? Off: none of your cards are available.
          </span>
        </span>
      </label>
      {on && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">Available to lend</legend>
          {DEFAULTS.map((d) => (
            <label key={d.value} className="flex items-start gap-3 text-sm">
              {/* Required only until a default is picked: asked once. */}
              <input
                type="radio"
                name="default"
                value={d.value}
                defaultChecked={d.value === current}
                required={!current}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="flex flex-col">
                <span className="font-medium">{d.label}</span>
                <span className="text-muted-foreground">{d.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-xs text-muted-foreground">Also with /collection lending in Discord.</p>
      <Button type="submit" size="sm" className="self-start">
        Save
      </Button>
    </form>
  );
}
