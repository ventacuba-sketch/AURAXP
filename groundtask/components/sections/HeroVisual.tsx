import { Logo } from "../ui/Logo";
import { Icon } from "../ui/Icon";
import { formatColor, type FileFormat } from "../ui/FileGlyph";

type PaperDoc = {
  title: string;
  lines: Array<[string, string]>;
  format: FileFormat | "XML";
  position: string;
};

// Fictional, anonymized documents — no real institutions or personal data.
const docs: PaperDoc[] = [
  {
    title: "Bank statement",
    lines: [
      ["Account", "•••• 4821"],
      ["Period", "2026-03"],
      ["Entries", "214"],
    ],
    format: "PDF",
    position: "left-[9%] top-[3%] rotate-[4deg]",
  },
  {
    title: "Invoice (DTE)",
    lines: [
      ["Folio", "1042"],
      ["RUT", "XX.XXX.XXX-X"],
      ["Total", "CLP 2.380.000"],
    ],
    format: "XML",
    position: "left-[3%] top-[22%] rotate-[3deg]",
  },
  {
    title: "Credit note",
    lines: [
      ["Folio", "211"],
      ["Ref. DTE", "1038"],
      ["Total", "CLP 415.650"],
    ],
    format: "PDF",
    position: "left-[0%] top-[44%] rotate-[2deg]",
  },
  {
    title: "Payment",
    lines: [
      ["Type", "Bank transfer"],
      ["Date", "2026-03-22"],
      ["Amount", "CLP 1.190.000"],
    ],
    format: "CSV",
    position: "left-[8%] top-[60%] rotate-[5deg]",
  },
];

const panelDocs: Array<{ name: string; format: FileFormat }> = [
  { name: "Bank statement", format: "PDF" },
  { name: "Invoice (DTE)", format: "XML" },
  { name: "Credit note (NC)", format: "PDF" },
  { name: "Payment", format: "CSV" },
];

const tags = ["Multi-document", "Multi-step", "Realistic", "Deterministic ground truth", "Expert-reviewed"];

function Paper({ doc }: { doc: PaperDoc }) {
  return (
    <div
      className={`absolute z-10 w-[29%] rounded-lg bg-[#eef0f2] p-3.5 text-graphite shadow-[0_24px_40px_-18px_rgb(0_0_0/0.9)] ring-1 ring-black/5 ${doc.position}`}
    >
      <p className="text-[0.8125rem] font-semibold">{doc.title}</p>
      <dl className="mt-2 space-y-1 text-[0.625rem] leading-tight text-graphite/70">
        {doc.lines.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-11 shrink-0">{k}</dt>
            <dd className="truncate font-medium text-graphite/85">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2.5 space-y-1.5">
        <span className="block h-[3px] w-full rounded bg-graphite/10" />
        <span className="block h-[3px] w-4/5 rounded bg-graphite/10" />
      </div>
      <span
        className={`absolute right-2.5 bottom-2.5 rounded px-1.5 py-0.5 text-[0.5625rem] font-bold text-white ${formatColor[doc.format]}`}
      >
        {doc.format}
      </span>
    </div>
  );
}

function Panel() {
  return (
    <div className="rounded-xl border border-line-strong bg-graphite/95 p-4 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9),0_0_0_1px_rgb(242_153_74/0.08)] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <Logo size={16} />
        <div className="flex items-center gap-2">
          <span className="hidden h-6 w-28 items-center gap-1.5 rounded border border-line bg-ink/60 px-2 text-mist sm:flex">
            <Icon name="search" className="size-3" />
          </span>
          <span className="size-2 rounded-full bg-copper/80" />
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 border-b border-line pb-3 text-[0.6875rem] text-mist">
        Business workflow <Icon name="chevronRight" className="size-3" />
        <span className="text-ivory/90">Bank reconciliation</span>
      </p>

      <div className="mt-4 grid grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] gap-4">
        <div>
          <p className="text-[0.6875rem] text-mist">Input documents</p>
          <ul className="mt-2 space-y-1.5">
            {panelDocs.map((d) => (
              <li
                key={d.name}
                className="flex items-center gap-2 rounded-md border border-line bg-graphite-light/50 px-2 py-1.5 text-[0.6875rem] text-ivory/85"
              >
                <span className={`size-2.5 shrink-0 rounded-[2px] ${formatColor[d.format]}`} />
                <span className="truncate">{d.name}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2 py-1.5 text-[0.6875rem] text-mist">
              <Icon name="plus" className="size-3" /> Add document
            </li>
          </ul>
        </div>

        <div>
          <div className="grid grid-cols-4 gap-1 text-center text-[0.625rem]">
            {["Task", "Ground truth", "Verifier", "Metadata"].map((t, i) => (
              <span
                key={t}
                className={`truncate rounded-md border px-1 py-1.5 ${
                  i === 0 ? "border-copper/70 bg-copper/10 text-copper-light" : "border-line text-mist"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mt-2 rounded-lg border border-line bg-ink/40 p-3">
            <p className="text-sm font-semibold text-ivory">Task</p>
            <p className="mt-1 text-[0.75rem] leading-snug text-ivory/80">
              Reconcile transactions for the month and identify discrepancies.
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full border border-line-strong px-2 py-0.5 text-[0.625rem] text-ivory/80"
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Product-style illustration of a task being assembled from source documents. */
export function HeroVisual() {
  return (
    <div aria-hidden="true" className="relative">
      {/* Desktop: document stack + workspace panel */}
      <div className="relative hidden aspect-[1.32] lg:block">
        <div className="tech-grid absolute -inset-8" />
        <div className="absolute top-[8%] right-0 w-[64%] origin-right [transform:perspective(1600px)_rotateY(-9deg)_rotateX(3deg)]">
          <Panel />
        </div>
        <div className="absolute inset-y-[4%] left-0 w-full">
          {docs.map((d) => (
            <Paper key={d.title} doc={d} />
          ))}
        </div>
      </div>
      {/* Tablet / mobile: panel only */}
      <div className="lg:hidden">
        <Panel />
      </div>
    </div>
  );
}
