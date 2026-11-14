import React from "react";
import type { ProsthesisReport } from "@bionicpro/contracts";
import type { ReportFormat } from "../reports/download";
import { REPORT_TABLE_HEADERS } from "../shared/reportTableHeaders";

interface Props {
  prosthesis: ProsthesisReport;
  disabled: boolean;
  exporting: ReportFormat | null;
  onDownload: (format: ReportFormat) => void;
}

const ProsthesisReportTable: React.FC<Props> = ({ prosthesis, disabled, exporting, onDownload }) => (
  <section className="mt-6 border-t pt-6" aria-labelledby={`prosthesis-${prosthesis.prosthesis_id}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h2 id={`prosthesis-${prosthesis.prosthesis_id}`} className="text-xl font-semibold">
          {prosthesis.prosthesis_model}
        </h2>
        <p className="text-gray-600">Серийный номер: {prosthesis.serial_number}. Записей: {prosthesis.rows.length}.</p>
      </div>
      <div className="flex gap-3">
        {(["pdf", "csv"] as const).map((format) => (
          <button key={format} onClick={() => onDownload(format)} disabled={disabled}
            className="px-4 py-2 border border-blue-600 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed">
            {exporting === format ? "Подготовка…" : `Скачать ${format.toUpperCase()}`}
          </button>
        ))}
      </div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <caption className="sr-only">Показатели протеза {prosthesis.serial_number} по дням</caption>
        <thead className="bg-gray-100">
          <tr>
            {REPORT_TABLE_HEADERS.map((title) => (
              <th key={title} scope="col" className="p-3">{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prosthesis.rows.map((row) => (
            <tr key={row.report_date} className="border-b">
              <td className="p-3 whitespace-nowrap">{row.report_date}</td>
              <td className="p-3">{row.measurements}</td>
              <td className="p-3">{row.movements_total}</td>
              <td className="p-3">{row.avg_reaction_ms} / {row.max_reaction_ms}</td>
              <td className="p-3">{row.battery_avg} / {row.battery_min}</td>
              <td className="p-3">{row.errors_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export default ProsthesisReportTable;
