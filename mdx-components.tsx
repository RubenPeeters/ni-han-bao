import type { MDXComponents } from "mdx/types";
import Link from "next/link";

// Docs prose, styled here so the MDX pages stay plain Markdown.
const components: MDXComponents = {
  h1: (props) => <h1 className="text-4xl font-semibold" {...props} />,
  h2: (props) => <h2 className="mt-4 text-2xl font-semibold" {...props} />,
  h3: (props) => <h3 className="mt-2 text-lg font-semibold" {...props} />,
  p: (props) => <p className="leading-relaxed" {...props} />,
  ul: (props) => <ul className="flex list-disc flex-col gap-1 pl-5" {...props} />,
  ol: (props) => <ol className="flex list-decimal flex-col gap-1 pl-5" {...props} />,
  code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm" {...props} />,
  a: ({ href = "", ...props }) => (
    <Link href={href} className="font-medium underline underline-offset-4 hover:text-gold" {...props} />
  ),
  // eslint-disable-next-line @next/next/no-img-element
  img: ({ alt = "", ...props }) => <img alt={alt} className="rounded-xl border" loading="lazy" {...props} />,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
