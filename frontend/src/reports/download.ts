import type { ProsthesisReport, ReportPeriod } from "@bionicpro/contracts";

export type ReportFormat = "pdf" | "csv";

export function reportFilename(prosthesis: ProsthesisReport, period: ReportPeriod, format: ReportFormat): string {
  return `bionicpro-report-prosthesis-${prosthesis.prosthesis_id}-${period.from ?? "all"}-${period.to}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
