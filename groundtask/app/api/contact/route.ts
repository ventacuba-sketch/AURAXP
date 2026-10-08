import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const interests = new Set(["RL environments", "Model evals", "Agent training", "Post-training", "Benchmarks", "Data sourcing", "Other"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid input");
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const get = (key: string) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
  if (get("website")) return NextResponse.json({ ok: true }); // Spam honeypot
  const name = get("name"), company = get("company"), email = get("email"), interest = get("interest"), message = get("message");
  if (!name || name.length > 120 || !company || company.length > 160 ||
      !emailPattern.test(email) || email.length > 254 || !interests.has(interest) ||
      !message || message.length > 5000) {
    return NextResponse.json({ error: "Please check the form fields." }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: "Contact form is temporarily unavailable. Please email contact@groundtask.com." }, { status: 503 });

  const safe = (s: string) => s.replace(/[\r\n]+/g, " ");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "GroundTask Website <website@groundtask.com>",
        to: ["contact@groundtask.com"],
        reply_to: email,
        subject: `GroundTask inquiry — ${safe(company).slice(0, 120)}`,
        text: `Name: ${safe(name)}\nCompany: ${safe(company)}\nWork email: ${safe(email)}\nInterest: ${interest}\n\n${message}`,
      }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("GroundTask contact delivery failed", response.status);
      return NextResponse.json({ error: "Message could not be delivered. Please email contact@groundtask.com." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Message could not be delivered. Please try again." }, { status: 502 });
  }
}
