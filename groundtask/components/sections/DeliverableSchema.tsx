import { Fragment } from "react";
import { revealDelay } from "@/lib/reveal";
import { Icon, type IconName } from "../ui/Icon";

// Content descriptors only — formats and schemas are defined with each team.
const modules: Array<{ icon: IconName; title: string; contents: string[] }> = [
  { icon: "fileText", title: "Structured task data", contents: ["tasks", "documents", "metadata"] },
  { icon: "database", title: "Ground truth", contents: ["verified answers", "explanations"] },
  { icon: "code", title: "Verifier specification", contents: ["evaluation criteria", "scoring logic"] },
  { icon: "clipboardList", title: "QA metadata", contents: ["review notes", "quality flags", "annotations"] },
];

/** Technical representation of what one delivered asset contains. */
export function DeliverableSchema() {
  return (
    <figure className="overflow-hidden rounded-xl border border-line-strong bg-ink/70 shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-graphite-light/40 px-4 py-2.5 font-mono text-[0.8125rem]">
        <span className="truncate text-ivory/85">
          <span className="text-copper">deliverable</span>
          <span className="text-mist"> / </span>sample-task
        </span>
        <span className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-xs text-mist">illustrative</span>
      </div>

      <ol className="grid grid-cols-2 gap-2.5 p-3 sm:gap-3 sm:p-4 md:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)] lg:items-stretch lg:gap-1.5">
        {modules.map((m, i) => (
          <Fragment key={m.title}>
            <li
              data-reveal
              style={revealDelay(i * 80)}
              className="flex flex-col rounded-lg border border-line bg-graphite/80 p-3 transition-colors duration-200 hover:border-copper/40 sm:p-3.5"
            >
              <div className="flex items-center justify-between font-mono text-xs text-mist">
                <span className="text-copper">{String(i + 1).padStart(2, "0")}</span>
                <Icon name={m.icon} className="size-4 text-copper/80" />
              </div>
              <p className="mt-2.5 text-[0.9375rem] leading-snug font-semibold text-ivory">{m.title}</p>
              <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5 font-mono text-[0.8125rem] leading-snug text-ivory/75">
                {m.contents.map((c) => (
                  <li key={c} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-copper/70">
                      +
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </li>
            {i < modules.length - 1 ? (
              <li aria-hidden="true" className="hidden items-center justify-center text-copper/70 lg:flex">
                <Icon name="chevronRight" className="size-4" strokeWidth={2} />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>

      <figcaption className="border-t border-line px-4 py-2.5 font-mono text-xs leading-relaxed text-mist">
        Formats and schemas are defined with each team to fit their training or evaluation pipeline.
      </figcaption>
    </figure>
  );
}
