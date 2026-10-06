"use client";

import { useState, type FormEvent } from "react";
import { contactMailto, interests, limits, type ContactPayload } from "@/lib/contact";
import { site } from "@/lib/site";
import { Icon } from "../ui/Icon";

const field =
  "mt-1.5 w-full rounded-md border border-line-strong bg-ink/70 px-3.5 py-2.5 text-[0.9375rem] text-ivory placeholder:text-mist/70 transition-colors focus:border-copper focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-copper/35";
const label = "text-sm font-medium text-ivory/85";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "error"; mailto: string; rateLimited: boolean };

/**
 * Contact form. Sends through `/api/contact` (Resend). If the API is not
 * available it offers a pre-filled email instead; without JavaScript it
 * degrades to a plain mailto form.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const get = (key: string) => String(data.get(key) ?? "").trim();
    const payload: ContactPayload = {
      name: get("name"),
      email: get("email"),
      company: get("company"),
      interest: get("interest"),
      message: get("message"),
    };

    setStatus({ state: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, website: get("website") }),
      });
      if (res.ok) {
        form.reset();
        setStatus({ state: "sent" });
        return;
      }
      setStatus({ state: "error", mailto: contactMailto(payload), rateLimited: res.status === 429 });
    } catch {
      setStatus({ state: "error", mailto: contactMailto(payload), rateLimited: false });
    }
  };

  const sending = status.state === "sending";

  return (
    <form
      action={`mailto:${site.email}`}
      method="post"
      encType="text/plain"
      onSubmit={onSubmit}
      className="relative rounded-xl border border-line-strong bg-graphite/85 p-4 shadow-card backdrop-blur-md sm:p-6"
      aria-describedby="contact-note"
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <label className="block">
          <span className={label}>Name</span>
          <input name="name" required maxLength={limits.name} autoComplete="name" className={field} />
        </label>
        <label className="block">
          <span className={label}>Company</span>
          <input name="company" required maxLength={limits.company} autoComplete="organization" className={field} />
        </label>
        <label className="col-span-2 block sm:col-span-1">
          <span className={label}>Work email</span>
          <input name="email" type="email" required maxLength={limits.email} autoComplete="email" className={field} />
        </label>
        <label className="col-span-2 block sm:col-span-1">
          <span className={label}>Interest</span>
          <select name="interest" defaultValue={interests[0]} className={`${field} appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
            {interests.map((i) => (
              <option key={i} value={i} className="bg-graphite">
                {i}
              </option>
            ))}
          </select>
        </label>
        {/* Honeypot for bots; hidden from people and assistive tech. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input name="website" type="text" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <label className="col-span-2 block">
          <span className={label}>What are you building?</span>
          <textarea name="message" rows={3} required maxLength={limits.message} className={`${field} resize-y`} />
        </label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={sending}
          aria-busy={sending}
          className="focus-ring inline-flex h-12 shrink-0 items-center whitespace-nowrap justify-center gap-2.5 rounded-md bg-copper px-6 font-medium text-graphite shadow-copper transition-colors hover:bg-copper-light disabled:cursor-wait disabled:opacity-80"
        >
          {sending ? "Sending…" : "Contact us"} <Icon name="arrowRight" className="size-4" />
        </button>
        <p
          id="contact-note"
          className={`text-[0.8125rem] ${status.state === "sent" ? "text-verify" : "text-mist"}`}
          role="status"
          aria-live="polite"
        >
          {status.state === "sent" ? (
            <>Thank you — your message was sent. We&apos;ll reply from {site.email}.</>
          ) : status.state === "error" ? (
            <>
              {status.rateLimited ? "Too many messages in a short time." : "We couldn't send your message."}{" "}
              <a className="text-copper underline underline-offset-2" href={status.mailto}>
                Send it by email instead
              </a>
              .
            </>
          ) : (
            <>We reply from {site.email}.</>
          )}
        </p>
      </div>
    </form>
  );
}
