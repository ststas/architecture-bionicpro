import type { ProsthesisReport, ReportRow } from "@bionicpro/contracts";

type ExportRow = ReportRow & Omit<ProsthesisReport, "rows">;

const columns: ReadonlyArray<{ key: keyof ExportRow; title: string }> = [
  { key: "report_date", title: "Дата" },
  { key: "prosthesis_id", title: "ID протеза" },
  { key: "prosthesis_model", title: "Модель протеза" },
  { key: "serial_number", title: "Серийный номер" },
  { key: "measurements", title: "Измерения" },
  { key: "movements_total", title: "Движения" },
  { key: "avg_reaction_ms", title: "Среднее время реакции, мс" },
  { key: "max_reaction_ms", title: "Максимальное время реакции, мс" },
  { key: "battery_min", title: "Минимальный заряд батареи, %" },
  { key: "battery_avg", title: "Средний заряд батареи, %" },
  { key: "errors_total", title: "Ошибки" },
];

function cell(value: string | number): string {
  const text = String(value);
  // Текстовые поля не должны интерпретироваться табличным редактором как формулы.
  const safe = typeof value === "string" && /^\s*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createReportCsv(prosthesis: ProsthesisReport): string {
  const lines = [
    columns.map(({ title }) => cell(title)).join(";"),
    ...prosthesis.rows.map((row) => {
      const exportRow: ExportRow = { ...prosthesis, ...row };
      return columns.map(({ key }) => cell(exportRow[key])).join(";");
    }),
  ];
  // BOM сохраняет кириллицу при открытии в Excel; разделитель — точка с запятой.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
