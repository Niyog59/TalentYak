import { headers } from "next/headers";

/**
 * Structured data for search engines. Only facts shown on the page — never a
 * rating, a review count or anything the page doesn't say. `<` is escaped so
 * text can't close the script element.
 */
export async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
