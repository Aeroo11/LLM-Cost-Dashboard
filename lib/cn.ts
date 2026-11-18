/**
 * Join class names, dropping falsy entries.
 *
 * Deliberately not `clsx` + `tailwind-merge`: nothing in this app conditionally
 * emits *conflicting* utilities, only additive ones, so the merge pass would be
 * dead weight in a project whose whole pitch is a six-dependency runtime.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
