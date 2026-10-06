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

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import `ventacuba-sketch/auraxp`.
2. **Root Directory:** `groundtask` (framework is detected as Next.js).
3. **Environment Variables** (Production and Preview): see `.env.example`.
4. Deploy. `vercel.json` skips builds for commits that don't touch `groundtask/`.
5. Settings → Git → **Production Branch**: the branch that holds the approved site.
6. Settings → Domains: add `groundtask.com` and `www.groundtask.com` (redirect www → apex)
   and create the DNS records Vercel shows at the domain's DNS provider.

## Contact form (Resend)

`POST /api/contact` validates input, drops honeypot submissions, throttles bursts and sends
the message through the Resend REST API (no SDK) with `reply_to` set to the visitor.

- Verify `groundtask.com` in Resend (DNS records shown in Resend → Domains) and create an API key.
- `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` as in `.env.example`.
- Without `RESEND_API_KEY` (or if Resend fails) the form offers a pre-filled email instead;
  without JavaScript it is a plain `mailto:` form.
- `CONTACT_TO_EMAIL` must be a mailbox that actually receives mail.

## Structure

- `app/` — layout (metadata, fonts, JSON-LD), page, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, icons
- `components/sections/` — one component per page section
- `components/ui/` — primitives (Icon, Logo, Button, SectionHeading, FeatureCard, FileGlyph, Mountains, Globe)
- `lib/site.ts` — brand constants, navigation, email
- `lib/sampleTasks.ts` — the fictional sample-task data shown in "Example task"

## Brand assets

`public/brand/groundtask-symbol.png` is the symbol extracted from the brand guide as a transparent PNG.
Replace it with the official SVG when available (same filename or update `components/ui/Logo.tsx`).
