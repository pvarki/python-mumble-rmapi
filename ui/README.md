# Voice federated component

The remote ships no CSS: rmui renders it with its own Tailwind build, so only the classes in that build work.

- Classes in the files copied from rmui's `components/ui` are always there. Any other class is checked
  against an rmui build.
- No `dark:` variants of our own, as rmui never sets `.dark`; the copies keep theirs.
- Hover and active states use `muted`: `accent` and `secondary` follow the deployment theme.
- Keyboard focus on a menu or select item shows a ring, as rmui's CSS has no muted focus background.
- Controls keep 40-44 px touch targets, so the copies' sizes differ from shadcn's.
- `DialogContent` has no built-in close button, whose label would be English only; callers add a translated
  `DialogClose`.
