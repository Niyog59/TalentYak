import { Icon } from "@/components/ui/icon";

/*
 * Where real photography goes. TalentYak does not use generated people or
 * stock models as if they were its coaches, so until real, consented photos
 * exist, this says plainly what belongs here.
 */
export function PhotoPlaceholder({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <figure
      className={`relative flex flex-col justify-end overflow-hidden rounded-2xl bg-brand-tint ${className}`}
    >
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-brand/35">
        <Icon name="camera" className="size-16" />
      </div>
      <figcaption className="relative m-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink">
        <span className="font-semibold">Photo placeholder.</span> {label}
      </figcaption>
    </figure>
  );
}
