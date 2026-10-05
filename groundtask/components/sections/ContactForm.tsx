"use client";

import { useState, type FormEvent } from "react";
import { site } from "@/lib/site";
import { Icon } from "../ui/Icon";

const interests = ["RL environments", "Model evals", "Agent training", "Post-training", "Benchmarks", "Data sourcing", "Other"];

const field =
  "mt-1.5 w-full rounded-md border border-line-strong bg-ink/70 px-3.5 py-2.5 text-[0.9375rem] text-ivory placeholder:text-mist/70 transition-colors focus:border-copper focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-copper/35";
const label = "text-sm font-medium text-ivory/85";

/**
 * Contact form without a backend: composes a pre-filled email to the company
 * inbox. Works without JS as a plain mailto form.
 */
export function ContactForm() {
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "").trim();
    const company = get("company");
    const subject = `GroundTask inquiry${company ? ` — ${company}` : ""}`;
    const body = [
      `Name: ${get("name")}`,
      `Work email: ${get("email")}`,
      `Company: ${company}`,
      `Interest: ${get("interest")}`,
      "",
      get("message"),
    ].join("\n");
    window.location.href = `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <form
      action={`mailto:${site.email}`}
      method="post"
      encType="text/plain"
      onSubmit={onSubmit}
      className="rounded-xl border border-line-strong bg-graphite/85 p-5 shadow-card backdrop-blur-md sm:p-6"
      aria-describedby="contact-note"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name</span>
          <input name="name" required autoComplete="name" className={field} />
        </label>
        <label className="block">
          <span className={label}>Work email</span>
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
        <label className="block">
          <span className={label}>Company</span>
          <input name="company" required autoComplete="organization" className={field} />
        </label>
        <label className="block">
          <span className={label}>Interest</span>
          <select name="interest" defaultValue={interests[0]} className={`${field} appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
            {interests.map((i) => (
              <option key={i} value={i} className="bg-graphite">
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>What are you building?</span>
          <textarea name="message" rows={4} required className={`${field} resize-y`} />
        </label>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          className="focus-ring inline-flex h-12 shrink-0 items-center whitespace-nowrap justify-center gap-2.5 rounded-md bg-copper px-6 font-medium text-graphite shadow-copper transition-colors hover:bg-copper-light"
        >
          Contact us <Icon name="arrowRight" className="size-4" />
        </button>
        <p id="contact-note" className="text-[0.8125rem] text-mist" aria-live="polite">
          {sent ? (
            <>
              Your email app should open with the message ready. If not, write to{" "}
              <a className="text-copper underline-offset-2 hover:underline" href={`mailto:${site.email}`}>
                {site.email}
              </a>
              .
            </>
          ) : (
            <>Opens your email app, addressed to {site.email}.</>
          )}
        </p>
      </div>
    </form>
  );
}
