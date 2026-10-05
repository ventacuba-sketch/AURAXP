export type FileFormat = "PDF" | "XML" | "CSV";

const formatColor: Record<FileFormat, string> = {
  PDF: "bg-[#d64545]",
  XML: "bg-[#2f80ed]",
  CSV: "bg-[#1f9d6b]",
};

/** Small document tile with a coloured format badge (functional colour only). */
export function FileGlyph({ format, className = "" }: { format: FileFormat; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-12 w-10 shrink-0 flex-col justify-start gap-[3px] rounded-[5px] bg-ivory px-[7px] pt-2 shadow-[0_6px_14px_-6px_rgb(0_0_0/0.6)] ${className}`}
    >
      <span className="h-[2px] w-4 rounded bg-graphite/25" />
      <span className="h-[2px] w-6 rounded bg-graphite/20" />
      <span className="h-[2px] w-5 rounded bg-graphite/20" />
      <span
        className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-[3px] px-1 text-[0.5625rem] font-bold leading-[0.875rem] tracking-wide text-white ${formatColor[format]}`}
      >
        {format}
      </span>
    </span>
  );
}

export { formatColor };
