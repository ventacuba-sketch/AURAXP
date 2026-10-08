"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { sampleTasks } from "@/lib/sampleTasks";
import { FileGlyph } from "../ui/FileGlyph";
import { Icon } from "../ui/Icon";
import { SectionHeading } from "../ui/SectionHeading";

function StepHeader({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <header>
      <h3 className="text-[0.9375rem] font-semibold tracking-[0.08em] text-ivory uppercase">
        <span className="mr-2 text-copper">{n}.</span>
        {title}
      </h3>
      <p className="mt-1 text-sm leading-snug text-ivory/80">{subtitle}</p>
    </header>
  );
}

function Step({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card flex flex-col p-3.5 sm:p-5 ${className}`}>{children}</div>;
}

function FlowArrow() {
  return (
    <div aria-hidden="true" className="-my-1.5 flex items-center justify-center text-copper md:hidden lg:my-0 lg:flex">
      <Icon name="arrowDown" className="size-5 lg:hidden" />
      <Icon name="arrowRight" className="hidden size-6 lg:block" />
    </div>
  );
}

export function SampleTask() {
  const [active, setActive] = useState(0);
  const [showTruth, setShowTruth] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const task = sampleTasks[active] ?? sampleTasks[0]!;
  const truthId = `${baseId}-truth`;

  const select = (index: number) => {
    setActive(index);
    setShowTruth(false);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, current: number) => {
    const last = sampleTasks.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = current === last ? 0 : current + 1;
    if (e.key === "ArrowLeft") next = current === 0 ? last : current - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section id="sample-task" aria-labelledby="sample-title" className="border-t border-line bg-ink">
      <div className="container-gt py-12 sm:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between" data-reveal>
          <SectionHeading id="sample-title" eyebrow="Example task" title="From real documents to a verifiable AI task." />
          <div
            role="tablist"
            aria-label="Sample workflows"
            className="grid shrink-0 grid-cols-2 gap-1 rounded-lg border border-line bg-graphite/60 p-1 sm:flex sm:self-start lg:self-auto"
          >
            {sampleTasks.map((t, i) => {
              const selected = i === active;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(i)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`focus-ring rounded-md px-3 py-2 text-[0.8125rem] font-medium whitespace-nowrap transition-colors ${
                    selected
                      ? "bg-ivory text-graphite shadow-[0_0_0_1px_rgb(242_153_74/0.9),0_0_18px_-4px_rgb(242_153_74/0.6)]"
                      : "text-ivory/75 hover:bg-graphite-light hover:text-ivory"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${task.id}`}
          className="mt-6 sm:mt-8"
          data-reveal
        >
          <p className="mb-4 text-xs text-mist">Illustrative example · synthetic data · not an executed evaluation</p>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.04fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,0.96fr)] lg:gap-2">
            {/* 1. Input */}
            <Step>
              <StepHeader n={1} title="Input" subtitle="Synthetic business document examples" />
              <ul className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-3 md:mt-4 md:grid-cols-1 md:gap-y-2.5">
                {task.inputs.map((doc) => (
                  <li key={doc.name} className="flex min-w-0 items-center gap-2.5 md:gap-3">
                    <FileGlyph format={doc.format} className="max-md:h-10 max-md:w-8" />
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 md:rounded-md md:border md:border-line md:bg-graphite-light/45 md:px-3 md:py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ivory">{doc.name}</p>
                        <p className="text-[0.8125rem] text-mist">{doc.meta}</p>
                      </div>
                      <Icon name="chevronRight" className="hidden size-4 shrink-0 text-mist md:block" />
                    </div>
                  </li>
                ))}
              </ul>
            </Step>

            <FlowArrow />

            {/* 2. Task */}
            <Step>
              <StepHeader n={2} title="Task" subtitle={task.task} />
              <div className="mt-3.5 rounded-lg border border-line bg-ink/40 p-3.5 md:mt-4 md:p-4">
                <p className="text-sm font-medium text-ivory/90">Task details</p>
                <ul className="mt-2.5 space-y-1.5 text-sm text-ivory/75">
                  {task.details.map((d) => (
                    <li key={d} className="flex gap-2.5">
                      <Icon name="plus" className="mt-[3px] size-3.5 shrink-0 text-copper" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="mt-3.5 flex flex-wrap gap-1.5 md:mt-4 md:gap-2" aria-label="Task properties">
                {task.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-line-strong bg-graphite-light/50 px-2.5 py-0.5 text-[0.8125rem] text-ivory/85 md:px-3 md:py-1"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            </Step>

            <FlowArrow />

            {/* 3. Ground truth */}
            <Step>
              <StepHeader n={3} title="Ground truth" subtitle="Illustrative expected answer" />
              <dl className="mt-3.5 flex-1 rounded-lg border border-line bg-ink/40 p-3.5 md:mt-4 md:p-4 lg:p-3.5 xl:p-4">
                <dt className="text-sm text-ivory/80">{task.groundTruth.primary.label}</dt>
                <dd className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-tight whitespace-nowrap text-verify tabular-nums lg:text-[1.25rem] xl:text-[1.4375rem]">
                  {task.groundTruth.primary.value}
                </dd>
                <dt className="mt-3 text-sm text-ivory/80 md:mt-5">{task.groundTruth.secondary.label}</dt>
                <dd className="mt-1 text-[1.625rem] leading-tight font-semibold text-verify tabular-nums">
                  {task.groundTruth.secondary.value}
                </dd>
              </dl>
              <button
                type="button"
                aria-expanded={showTruth}
                aria-controls={truthId}
                onClick={() => setShowTruth((v) => !v)}
                className="focus-ring mt-3 flex h-11 items-center md:mt-4 justify-center gap-2 rounded-md border border-line-strong text-sm text-ivory transition-colors hover:border-ivory/60 hover:bg-ivory/5"
              >
                {showTruth ? "Hide full ground truth" : "View full ground truth"}
                <Icon
                  name={showTruth ? "chevronDown" : "arrowRight"}
                  className="size-4 transition-transform"
                />
              </button>
            </Step>

            <FlowArrow />

            {/* 4. Verifier */}
            <Step>
              <StepHeader n={4} title="Verifier" subtitle="Proposed deterministic checks" />
              <ul className="mt-3.5 grid grid-cols-2 gap-2 md:mt-4 md:grid-cols-1">
                {task.checks.map((c) => (
                  <li
                    key={c}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-graphite-light/45 px-3 py-2 text-sm leading-snug text-ivory/90 md:gap-3 md:py-2.5"
                  >
                    {c}
                    <Icon name="check" className="size-5 shrink-0 text-verify" strokeWidth={2.5} />
                    <span className="sr-only">illustrative check</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 flex h-11 items-center gap-3 rounded-md bg-verify md:mt-3 md:h-12 px-4 text-base font-semibold tracking-wide text-graphite">
                <Icon name="checkCircle" className="size-6" strokeWidth={2} />
                PASS
              </p>
            </Step>
          </div>

          <div id={truthId} hidden={!showTruth} className="mt-4">
            <div className="card overflow-hidden">
              <p className="border-b border-line px-4 py-3 text-sm font-medium text-ivory sm:px-5">
                Full ground truth — {task.label}
              </p>
              <ul className="divide-y divide-line">
                {task.groundTruth.breakdown.map((row) => (
                  <li
                    key={row.item}
                    className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-5"
                  >
                    <span className="text-sm font-medium text-ivory">{row.item}</span>
                    <span className="text-sm text-mist">{row.detail}</span>
                    <span className="text-sm font-semibold text-verify tabular-nums sm:text-right">{row.amount}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
