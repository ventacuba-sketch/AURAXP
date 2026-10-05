import { Icon, type IconName } from "../ui/Icon";
import { Mountains } from "../ui/Mountains";
import { SectionHeading } from "../ui/SectionHeading";
import { revealDelay } from "@/lib/reveal";

const problems: Array<{ icon: IconName; title: string }> = [
  { icon: "fileText", title: "Incomplete data" },
  { icon: "database", title: "Inconsistent documents" },
  { icon: "alertTriangle", title: "Exceptions and edge cases" },
  { icon: "user", title: "Manual decisions" },
];

export function Problem() {
  return (
    <section
      aria-labelledby="problem-title"
      className="relative isolate overflow-hidden border-t border-line bg-graphite"
    >
      <Mountains id="mt-problem" className="absolute right-0 bottom-0 -z-10 hidden h-full w-1/2 opacity-50 lg:block" />
      <div className="container-gt grid gap-8 py-12 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
        <div data-reveal>
          <SectionHeading
            id="problem-title"
            eyebrow="The problem"
            title={
              <>
                AI can simulate business work. <span className="block">Real operations are messier.</span>
              </>
            }
          />
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/75 sm:text-[1.0625rem]">
            Real business workflows include incomplete information, inconsistent documents, exceptions, manual
            decisions and edge cases — difficult to capture with fully synthetic data. Scenarios that are too clean
            teach models to succeed where real operations rarely look like that.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {problems.map((p, i) => (
            <li
              key={p.title}
              data-reveal
              style={revealDelay(i * 70)}
              className="card flex items-center gap-3 bg-graphite/70 p-3.5 backdrop-blur-sm sm:min-h-36 sm:flex-col sm:items-start sm:gap-0 sm:p-5"
            >
              <Icon name={p.icon} className="size-6 shrink-0 text-copper sm:size-8" strokeWidth={1.4} />
              <h3 className="text-[0.9375rem] leading-snug font-semibold text-ivory sm:mt-auto sm:pt-5">{p.title}</h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
