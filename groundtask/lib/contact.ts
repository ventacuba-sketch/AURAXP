import { site } from "./site";

export const interests = [
  "RL environments",
  "Model evals",
  "Agent training",
  "Post-training",
  "Benchmarks",
  "Data sourcing",
  "Other",
] as const;

export type ContactPayload = {
  name: string;
  email: string;
  company: string;
  interest: string;
  message: string;
};

export const limits = { name: 120, email: 254, company: 160, message: 5000 } as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates and normalises untrusted input. Returns null when invalid. */
export function parseContact(input: unknown): ContactPayload | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");

  const payload: ContactPayload = {
    name: str("name"),
    email: str("email"),
    company: str("company"),
    interest: str("interest"),
    message: str("message"),
  };

  if (!payload.name || payload.name.length > limits.name) return null;
  if (!emailPattern.test(payload.email) || payload.email.length > limits.email) return null;
  if (!payload.company || payload.company.length > limits.company) return null;
  if (!payload.message || payload.message.length > limits.message) return null;
  if (!(interests as readonly string[]).includes(payload.interest)) payload.interest = "Other";
  return payload;
}

export function contactSubject(p: Pick<ContactPayload, "company">) {
  return `GroundTask inquiry${p.company ? ` — ${p.company}` : ""}`;
}

export function contactText(p: ContactPayload) {
  return [
    `Name: ${p.name}`,
    `Work email: ${p.email}`,
    `Company: ${p.company}`,
    `Interest: ${p.interest}`,
    "",
    p.message,
  ].join("\n");
}

/** Pre-filled email used when the API is unavailable or JS is disabled. */
export function contactMailto(p: ContactPayload) {
  return `mailto:${site.email}?subject=${encodeURIComponent(contactSubject(p))}&body=${encodeURIComponent(contactText(p))}`;
}
