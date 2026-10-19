import commands from "@/lib/commands.json";

// Generated from the bot's definitions (bot/src/commands.ts), never edited by hand.
export function CommandReference() {
  return (
    <div className="flex flex-col gap-4">
      {commands.map((command) => (
        <section key={command.name} id={command.name} className="card flex scroll-mt-6 flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-mono text-lg font-semibold">/{command.name}</h2>
            {command.admin && <span className="text-xs text-muted-foreground">Manage Server only</span>}
          </div>
          {command.usages.map((usage) => (
            <div key={usage.name} className="flex flex-col gap-1">
              {command.usages.length > 1 && <h3 className="font-mono font-semibold">/{usage.name}</h3>}
              <p className="text-muted-foreground">{usage.description}</p>
              {usage.options.length > 0 && (
                <ul className="flex flex-col gap-1 pl-4">
                  {usage.options.map((o) => (
                    <li key={o.name}>
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{o.name}</code>{" "}
                      <span className="text-xs text-muted-foreground">
                        {o.type}, {o.required ? "required" : "optional"}
                      </span>
                      : {o.description}
                      {o.choices.length > 0 && <span className="block text-muted-foreground">One of: {o.choices.join(", ")}.</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
