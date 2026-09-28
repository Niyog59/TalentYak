/* A food photo through the media route, or words saying why there isn't one. */
export function FoodPhoto({ mediaId, state, alt }: { mediaId: string | null; state: string | null; alt: string }) {
  if (!mediaId) return null;
  if (state === "ready") {
    return (
      <a href={`/api/media/${mediaId}`} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/media/${mediaId}?variant=preview`} alt={alt} className="aspect-square w-full max-w-48 rounded-lg bg-brand-tint object-cover" />
      </a>
    );
  }
  const text = state === "deleted" ? "Photo removed" : state === "hidden" ? "Photo not shared" : state === "failed" ? "Photo couldn't be used" : "Photo processing…";
  return <p className="flex aspect-square w-full max-w-48 items-center justify-center rounded-lg border border-dashed border-line-strong p-2 text-center text-sm text-ink-muted">{text}</p>;
}
