const LINK = "font-medium text-crystal underline underline-offset-4 hover:text-crystal/80";

// The address is a Vercel setting, never committed: a privacy question should not need to be public.
export function Contact() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const issue = (
    <a href="https://github.com/RubenPeeters/ni-han-bao/issues" className={LINK}>
      {email ? "open" : "Open"} an issue on GitHub
    </a>
  );
  if (!email) return issue;
  return (
    <>
      Email{" "}
      <a href={`mailto:${email}`} className={`${LINK} break-all`}>
        {email}
      </a>
      , or {issue}
    </>
  );
}
