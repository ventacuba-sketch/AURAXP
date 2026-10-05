import type { FileFormat } from "@/components/ui/FileGlyph";

export type SampleTask = {
  id: string;
  label: string;
  inputs: Array<{ name: string; meta: string; format: FileFormat }>;
  task: string;
  details: string[];
  tags: string[];
  groundTruth: {
    primary: { label: string; value: string };
    secondary: { label: string; value: string };
    breakdown: Array<{ item: string; detail: string; amount: string }>;
  };
  checks: string[];
};

const defaultTags = ["Multi-document", "Multi-step", "Realistic", "Deterministic ground truth", "Expert-reviewed"];

/**
 * Illustrative examples from a Chilean month-end close. All documents, folios
 * and amounts are fictional; no real institutions or personal data.
 */
export const sampleTasks: SampleTask[] = [
  {
    id: "bank-reconciliation",
    label: "Bank reconciliation",
    inputs: [
      { name: "Bank statement", meta: "PDF · 12 pages", format: "PDF" },
      { name: "Invoice (DTE)", meta: "XML · 1 file", format: "XML" },
      { name: "Credit note", meta: "PDF · 1 file", format: "PDF" },
      { name: "Payment", meta: "CSV · 1 file", format: "CSV" },
    ],
    task: "Reconcile transactions for the month and identify discrepancies.",
    details: [
      "Use all provided documents",
      "Match transactions",
      "Identify and explain discrepancies",
      "Apply Chilean accounting rules",
    ],
    tags: defaultTags,
    groundTruth: {
      primary: { label: "Total reconciled", value: "CLP 18,420,500" },
      secondary: { label: "Discrepancies identified", value: "3" },
      breakdown: [
        { item: "Partial payment", detail: "DTE 1042 invoiced CLP 2,380,000; transfer received for half", amount: "CLP 1,190,000" },
        { item: "Credit note not applied", detail: "NC 211 references DTE 1038 but is missing from the ledger", amount: "CLP 415,650" },
        { item: "Unidentified deposit", detail: "Bank credit on 2026-03-27 with no supporting document", amount: "CLP 640,000" },
      ],
    },
    checks: ["Correct matches", "Correct discrepancies", "Amounts within tolerance", "Business rules applied"],
  },
  {
    id: "dte-invoices",
    label: "DTE and invoices",
    inputs: [
      { name: "Sales register (RCV)", meta: "CSV · 1 file", format: "CSV" },
      { name: "Invoices (DTE)", meta: "XML · 48 files", format: "XML" },
      { name: "Credit notes", meta: "XML · 3 files", format: "XML" },
    ],
    task: "Validate the month's issued DTEs against the sales register and flag mismatches.",
    details: [
      "Parse every DTE document",
      "Match folio, tax ID and amounts to the RCV",
      "Recompute net, IVA (19%) and total",
      "Flag and explain each mismatch",
    ],
    tags: defaultTags,
    groundTruth: {
      primary: { label: "Documents validated", value: "51" },
      secondary: { label: "Mismatches identified", value: "2" },
      breakdown: [
        { item: "IVA miscalculated", detail: "DTE 1057: tax computed on the wrong net amount", amount: "CLP 19,000" },
        { item: "Missing from register", detail: "NC 214 issued but not recorded in the RCV", amount: "CLP 238,000" },
      ],
    },
    checks: ["Folios matched", "Tax amounts recomputed", "Mismatches identified", "Business rules applied"],
  },
  {
    id: "vat-f29",
    label: "VAT / F29",
    inputs: [
      { name: "RCV — sales", meta: "CSV · 1 file", format: "CSV" },
      { name: "RCV — purchases", meta: "CSV · 1 file", format: "CSV" },
      { name: "Credit notes", meta: "XML · 3 files", format: "XML" },
      { name: "Prior-month F29", meta: "PDF · 1 page", format: "PDF" },
    ],
    task: "Compute the month's IVA position for the F29 declaration.",
    details: [
      "Aggregate output and input VAT",
      "Apply credit notes to the correct period",
      "Carry forward the prior-month credit",
      "Explain every adjustment",
    ],
    tags: defaultTags,
    groundTruth: {
      primary: { label: "IVA payable", value: "CLP 1,284,300" },
      secondary: { label: "Adjustments applied", value: "2" },
      breakdown: [
        { item: "Output VAT (débito fiscal)", detail: "Sales net of credit notes", amount: "CLP 4,912,600" },
        { item: "Input VAT (crédito fiscal)", detail: "Eligible purchases for the period", amount: "− CLP 3,412,700" },
        { item: "Prior-month credit (remanente)", detail: "Carried forward from previous F29", amount: "− CLP 215,600" },
      ],
    },
    checks: ["Period totals correct", "Credit notes applied", "Carry-forward applied", "Business rules applied"],
  },
  {
    id: "discrepancies",
    label: "Discrepancies",
    inputs: [
      { name: "Reconciliation output", meta: "CSV · 1 file", format: "CSV" },
      { name: "Customer ledger", meta: "CSV · 1 file", format: "CSV" },
      { name: "Related communications", meta: "PDF · 6 files", format: "PDF" },
      { name: "Bank statement", meta: "PDF · 12 pages", format: "PDF" },
    ],
    task: "Classify each open discrepancy and propose the corrective action.",
    details: [
      "Classify each item by root cause",
      "Use related communications as evidence",
      "Propose the corrective entry",
      "Escalate items that need a human decision",
    ],
    tags: defaultTags,
    groundTruth: {
      primary: { label: "Open amount", value: "CLP 2,245,650" },
      secondary: { label: "Discrepancies classified", value: "3" },
      breakdown: [
        { item: "Partial payment", detail: "Keep balance open; follow up with customer", amount: "CLP 1,190,000" },
        { item: "Credit note not applied", detail: "Apply NC 211 against the DTE 1038 receivable", amount: "CLP 415,650" },
        { item: "Unidentified deposit", detail: "Escalate: no supporting document or reference", amount: "CLP 640,000" },
      ],
    },
    checks: ["Root causes correct", "Evidence cited", "Corrective actions valid", "Escalations justified"],
  },
];
