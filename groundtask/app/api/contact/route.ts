import { NextResponse } from "next/server";
import { contactSubject, contactText, parseContact, type ContactPayload } from "@/lib/contact";
import { site } from "@/lib/site";

// Best-effort per-instance throttle. Serverless instances don't share memory,
// so this only blunts bursts from a single client; Resend's own limits apply too.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function throttled(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function html(p: ContactPayload) {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0b1620">
<table>${row("Name", p.name)}${row("Work email", p.email)}${row("Company", p.company)}${row("Interest", p.interest)}</table>
<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(p.message)}</p>
</div>`;
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // Honeypot: real users never fill the hidden "website" field.
  if (typeof body === "object" && body !== null && (body as Record<string, unknown>).website) {
    return NextResponse.json({ ok: true });
  }

  const payload = parseContact(body);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (throttled(ip)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || `GroundTask Website <website@${site.domain}>`,
      to: [process.env.CONTACT_TO_EMAIL || site.email],
      reply_to: payload.email,
      subject: contactSubject(payload),
      text: contactText(payload),
      html: html(payload),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res?.ok) {
    console.error("contact: Resend request failed", res?.status, res ? await res.text().catch(() => "") : "network");
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
