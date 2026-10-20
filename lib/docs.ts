/** The docs sidebar, in reading order. Every app/docs page is in it (docs.test.mjs). */
export const DOCS = [
  { title: "Docs", pages: [{ href: "/docs", label: "Overview" }] },
  {
    title: "Get started",
    pages: [
      { href: "/docs/get-started/add-the-bot", label: "Add the bot" },
      { href: "/docs/get-started/set-up", label: "Set it up" },
      { href: "/docs/get-started/link-accounts", label: "Link your accounts" },
      { href: "/docs/get-started/events", label: "Events and stores" },
      { href: "/docs/get-started/riftbound", label: "Riftbound" },
    ],
  },
  {
    title: "Tutorial",
    pages: [
      { href: "/docs/tutorial/new-server", label: "A new server" },
      { href: "/docs/tutorial/server-stats", label: "A month of activity" },
      { href: "/docs/tutorial/league", label: "League" },
      { href: "/docs/tutorial/riftbound", label: "Riftbound night" },
      { href: "/docs/tutorial/privacy", label: "Privacy and leaving" },
    ],
  },
  { title: "Reference", pages: [{ href: "/docs/commands", label: "Commands" }] },
];
