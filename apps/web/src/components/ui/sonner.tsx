import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "@/lib/icons";
import { useTheme } from "@/lib/theme";

/**
 * Deviates from the stock shadcn file in two ways, both deliberate:
 *
 *  1. The generated version imports `useTheme` from `next-themes`. This is not
 *     a Next.js app and next-themes needs a provider that main.tsx (owned
 *     elsewhere) cannot mount; it was pulled in only as a transitive of this
 *     one file. Swapped for the project's own provider-free theme store.
 *  2. The generated version hardcodes five lucide-react icons. Those now come
 *     from the semantic icon registry, so a set swap reaches the toasts too.
 *
 * Colours are untouched: every one already resolves through a token var.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <Icon name="feedback.success" className="size-4" />,
        info: <Icon name="feedback.info" className="size-4" />,
        warning: <Icon name="feedback.warning" className="size-4" />,
        error: <Icon name="feedback.error" className="size-4" />,
        loading: <Icon name="feedback.loading" className="size-4" spin />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--status-success-bg)",
          "--success-text": "var(--status-success-fg)",
          "--success-border": "var(--status-success-border)",
          "--error-bg": "var(--status-danger-bg)",
          "--error-text": "var(--status-danger-fg)",
          "--error-border": "var(--status-danger-border)",
          "--warning-bg": "var(--status-warning-bg)",
          "--warning-text": "var(--status-warning-fg)",
          "--warning-border": "var(--status-warning-border)",
          "--info-bg": "var(--status-info-bg)",
          "--info-text": "var(--status-info-fg)",
          "--info-border": "var(--status-info-border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
