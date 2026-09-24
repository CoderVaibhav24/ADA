/** How a person is shown. */
export type ActorLabel = {
  /** Their name, or the Keycloak id when the API could not resolve one. */
  text: string;
  /** The id, as a tooltip, whenever the text is a name. */
  title: string | undefined;
  /** True when `text` is the raw id, so it can be set in a monospace face. */
  isId: boolean;
};

// The API's `*_name` field when it has one, else the id itself (docs/icms/actor-names.md).
export function actorLabel(
  name: string | null | undefined,
  id: string | null | undefined,
): ActorLabel {
  const resolved = name?.trim();
  if (resolved) return { text: resolved, title: id ?? undefined, isId: false };
  return { text: id ?? "", title: undefined, isId: true };
}
