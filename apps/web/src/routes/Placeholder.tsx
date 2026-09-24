import { Link, useLocation } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconKey } from "@/lib/icons";

import { usePlaceholderLabels } from "@/i18n/labels";
import { ROOT_PATH } from "./paths";

export interface PlaceholderProps {
  title: string;
  note: string;
  icon?: IconKey;
}

export default function Placeholder({
  title,
  note,
  icon = "feedback.info",
}: PlaceholderProps) {
  const location = useLocation();
  const labels = usePlaceholderLabels();

  return (
    <section className="flex min-h-[55vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
        <Icon name={icon} className="size-6" />
      </span>

      <Badge variant="secondary">{labels.kicker}</Badge>

      <div className="flex max-w-prose flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-fg-strong sm:text-3xl">
          {title}
        </h1>
        <p className="text-sm text-fg-muted text-pretty">{note}</p>
        <p className="text-sm text-fg-muted text-pretty">{labels.body}</p>
      </div>
      <p className="flex flex-wrap items-center justify-center gap-2 text-2xs text-fg-faint">
        <span>{labels.pathLabel}</span>
        <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono break-all">
          {location.pathname}
        </code>
      </p>

      <Button asChild variant="outline" size="sm">
        <Link to={ROOT_PATH}>
          <Icon name="action.back" className="size-4" />
          {labels.back}
        </Link>
      </Button>
    </section>
  );
}
