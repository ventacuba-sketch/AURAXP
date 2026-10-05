# GroundTask — groundtask.com

Marketing site for GroundTask: *Real-world workflows. Verifiable AI tasks.*

Self-contained Next.js app (App Router, TypeScript strict, Tailwind CSS v4). It lives in
`groundtask/` and is independent from the AURAXP Expo app at the repository root.

## Commands

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run build && npm start
```

## Deploy

Every route is statically prerendered. Recommended: Vercel with **Root Directory = `groundtask`**
(framework auto-detected). Any Node 20+ host running `npm run build && npm start` also works.

## Structure

- `app/` — layout (metadata, fonts, JSON-LD), page, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, icons
- `components/sections/` — one component per page section
- `components/ui/` — primitives (Icon, Logo, Button, SectionHeading, FeatureCard, FileGlyph, Mountains, Globe)
- `lib/site.ts` — brand constants, navigation, email
- `lib/sampleTasks.ts` — the fictional sample-task data shown in "Example task"

## Contact

The contact form has no backend: it composes a pre-filled email to `contact@groundtask.com`
(and degrades to a plain `mailto:` form without JavaScript).

## Brand assets

`public/brand/groundtask-symbol.png` is the symbol extracted from the brand guide as a transparent PNG.
Replace it with the official SVG when available (same filename or update `components/ui/Logo.tsx`).
