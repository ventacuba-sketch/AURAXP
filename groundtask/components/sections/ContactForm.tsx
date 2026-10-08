"use client";

import { useState, type FormEvent } from "react";
import { site } from "@/lib/site";
import { Icon } from "../ui/Icon";

const interests = ["RL environments", "Model evals", "Agent training", "Post-training", "Benchmarks", "Data sourcing", "Other"];
const field = "mt-1.5 w-full rounded-md border border-line-strong bg-ink/70 px-3.5 py-2.5 text-[0.9375rem] text-ivory placeholder:text-mist/70 transition-colors focus:border-copper focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-copper/35";
const label = "text-sm font-medium text-ivory/85";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === "sending") return;
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not send message.");
      form.reset();
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
      setStatus("error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line-strong bg-graphite/85 p-4 shadow-card backdrop-blur-md sm:p-6" aria-describedby="contact-note">
      <div className="hidden" aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <label className="block"><span className={label}>Name</span><input name="name" required maxLength={120} autoComplete="name" className={field} /></label>
        <label className="block"><span className={label}>Company</span><input name="company" required maxLength={160} autoComplete="organization" className={field} /></label>
        <label className="col-span-2 block sm:col-span-1"><span className={label}>Work email</span><input name="email" type="email" required maxLength={254} autoComplete="email" className={field} /></label>
        <label className="col-span-2 block sm:col-span-1">
          <span className={label}>Interest</span>
          <select name="interest" defaultValue={interests[0]} className={`${field} appearance-none pr-9`}>
            {interests.map((i) => <option key={i} value={i} className="bg-graphite">{i}</option>)}
          </select>
        </label>
        <label className="col-span-2 block"><span className={label}>What are you building?</span><textarea name="message" rows={3} maxLength={5000} required className={`${field} resize-y`} /></label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" disabled={status === "sending"} className="focus-ring inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-md bg-copper px-6 font-medium text-graphite shadow-copper transition-colors hover:bg-copper-light disabled:cursor-wait disabled:opacity-60">
          {status === "sending" ? "Sending…" : "Send message"} <Icon name="arrowRight" className="size-4" />
        </button>
        <p id="contact-note" role="status" aria-live="polite" className={`text-[0.8125rem] ${status === "error" ? "text-red-300" : status === "success" ? "text-verify" : "text-mist"}`}>
          {status === "success" ? "Message sent successfully. We'll be in touch." :
           status === "error" ? <>{error} You can also write to <a className="text-copper underline" href={`mailto:${site.email}`}>{site.email}</a>.</> :
           "Your message will be sent securely from this form."}
        </p>
      </div>
    </form>
  );
}
