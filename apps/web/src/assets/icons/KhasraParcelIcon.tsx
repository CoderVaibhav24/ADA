import type { LocalIconProps } from "@/lib/icons/types";

/**
 * Cadastral parcel with a khasra subdivision — an irregular survey plot, not a
 * rectangle. No general-purpose icon set ships this idea, which is exactly the
 * case the local-SVG escape hatch exists for. Authored here, so there is no
 * third-party licence attached.
 *
 * Contract for every local icon (see src/lib/icons/README.md):
 *   - 24x24 viewBox, stroke-based, stroke-width 2, currentColor
 *   - width/height default to 1em so `className="size-4"` governs the size
 *   - no fill colour and no hex anywhere
 */
export function KhasraParcelIcon({ className, ...props }: LocalIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M3 7.5 10 3.5l11 3.5-1.5 11L8.5 20.5 3 16.5Z" />
      <path d="M10 3.5 8.5 20.5" />
      <path d="M8.5 12 19.5 10" />
    </svg>
  );
}
