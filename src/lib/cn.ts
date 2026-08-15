/**
 * Joins truthy class strings.
 *
 * Deliberately not `clsx` + `tailwind-merge`: this app takes one new UI
 * dependency (lucide-react) and no more. The consequence is that there is no
 * conflict resolution -- a later `px-2` does not beat an earlier `px-4`.
 *
 * So the primitives in `components/ui/` take variant and size props, and their
 * `className` prop is contractually for *layout only* (margin, width, flex and
 * grid placement). Passing colour or padding through it is a bug, not a
 * shortcut, because the result depends on stylesheet order rather than on the
 * call site.
 */
export function cn(
  ...parts: (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(" ");
}
