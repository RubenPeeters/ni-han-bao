"use client";

import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useActionState, useEffect, useState, type ReactNode } from "react";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Radio buttons with a visible label each; the whole row is the 44px target. */
export function Options({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly Option[];
  value: string;
  onChange?: (value: string) => void;
}) {
  return options.map((o) => (
    <label key={o.value} className="flex min-h-11 items-start gap-3 py-1 text-sm">
      <input
        type="radio"
        name={name}
        value={o.value}
        {...(onChange ? { checked: o.value === value, onChange: () => onChange(o.value) } : { defaultChecked: o.value === value })}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="flex flex-col">
        <span className="font-medium">{o.label}</span>
        {o.hint && <span className="text-muted-foreground">{o.hint}</span>}
      </span>
    </label>
  ));
}

/**
 * A settings form around one of the profile's server actions, which throw on failure (the
 * error page then shows). "Saved" stays until the form is changed again.
 */
export function SettingsForm({ action, children }: { action: (formData: FormData) => Promise<void>; children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [saved, submit, pending] = useActionState(async (_: boolean, formData: FormData) => {
    await action(formData);
    setDirty(false);
    return true;
  }, false);
  return (
    <form action={submit} onChange={() => setDirty(true)} className="flex flex-col gap-4">
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? "Saving…" : "Save"}
        </Button>
        <p role="status" className="flex items-center gap-1 text-sm text-muted-foreground">
          {saved && !dirty && !pending && (
            <>
              <Check aria-hidden className="size-4 text-primary" /> Saved
            </>
          )}
        </p>
      </div>
    </form>
  );
}

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System", hint: "Follows your device." },
];

/** The account menu's theme choice; it applies at once, so there is nothing to save. */
export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // The theme is only known in the browser; until then no option is shown as chosen.
  useEffect(() => setMounted(true), []);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-2 text-sm font-medium">Theme</legend>
      <Options name="theme" options={THEMES} value={mounted ? (theme ?? "system") : ""} onChange={setTheme} />
    </fieldset>
  );
}
