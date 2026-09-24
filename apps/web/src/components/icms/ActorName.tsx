import { actorLabel } from "@/lib/actor";
import { cn } from "@/lib/utils";

// A person by name with their id as the tooltip, or the id in monospace when no name resolved.
export function ActorName({
  name,
  id,
  className,
}: {
  name: string | null | undefined;
  id: string | null | undefined;
  className?: string;
}) {
  const label = actorLabel(name, id);
  return (
    <span
      className={cn(label.isId && "font-mono text-xs break-all", className)}
      title={label.title}
    >
      {label.text}
    </span>
  );
}
