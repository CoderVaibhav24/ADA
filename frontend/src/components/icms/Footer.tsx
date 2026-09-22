import type { ReactNode } from "react";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";

/**
 * The app footer.
 *
 * Figma designs no desktop footer at all. The only footer in the file is on the
 * mobile login (163:27): a copyright line plus `Security Policy` / `GIS Portal`
 * / `Terms of Service`. This derives the desktop footer from that — same three
 * obligations (ownership, policy links, support contact) rendered against the
 * shell's own tokens, sitting on the canvas rather than on a card so it reads
 * as chrome and not as content.
 *
 * Everything displayed arrives as props. The component holds no English, no
 * copyright holder, no year and no phone number, because all four differ
 * between the ADA deployment and any other and all four need translating.
 */
export type FooterLink = {
  id: string;
  label: ReactNode;
  href: string;
  external?: boolean;
};

export type FooterProps = {
  /** e.g. "© 2026 Agra Development Authority". Caller formats and translates. */
  copyright: ReactNode;
  links?: readonly FooterLink[];
  /** Support line. Figma's login reads "Facing issues? Contact support at ...". */
  support?: ReactNode;
  /** Build/version stamp. Monospace, muted — useful on a government support call. */
  version?: ReactNode;
  /**
   * Third-party attribution. Iconify's bundled sets need none, but a Flaticon
   * free-tier icon would land here. See src/lib/icons/README.md.
   */
  attribution?: ReactNode;
  className?: string;
};

export function Footer({
  copyright,
  links = [],
  support,
  version,
  attribution,
  className,
}: FooterProps) {
  return (
    <footer
      data-slot="app-footer"
      className={cn(
        "w-full border-t border-line-subtle bg-surface-canvas",
        // Wraps at every breakpoint instead of assuming the strings fit on one
        // line: Hindi runs materially longer than English and this is the first
        // place a fixed-height footer would clip.
        "px-4 py-3 sm:px-6",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-2 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{copyright}</span>
          {version && (
            <>
              <Separator
                orientation="vertical"
                className="hidden h-3 sm:block"
                aria-hidden
              />
              <span className="font-mono text-2xs text-fg-faint tabular">
                {version}
              </span>
            </>
          )}
        </div>

        {(links.length > 0 || support) && (
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {links.map((link) => (
              <a
                key={link.id}
                href={link.href}
                {...(link.external
                  ? { target: "_blank", rel: "noreferrer noopener" }
                  : {})}
                className="rounded-xs underline-offset-4 transition-colors duration-fast ease-standard hover:text-fg-link hover:underline focus-visible:text-fg-link"
              >
                {link.label}
              </a>
            ))}
            {support && <span className="text-fg-faint">{support}</span>}
          </nav>
        )}
      </div>

      {attribution && (
        <div className="mx-auto mt-2 w-full max-w-(--layout-content-max) text-2xs text-fg-faint">
          {attribution}
        </div>
      )}
    </footer>
  );
}
