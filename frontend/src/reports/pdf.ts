import type { ProsthesisReport, ReportPeriod } from "@bionicpro/contracts";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { REPORT_TABLE_HEADERS } from "../shared/reportTableHeaders";

let fontPromise: Promise<string> | undefined;

function loadFont(): Promise<string> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const response = await fetch(`${process.env.PUBLIC_URL}/fonts/NotoSans-Regular.ttf`);
      if (!response.ok) throw new Error("Не удалось загрузить шрифт PDF");
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Не удалось прочитать шрифт PDF"));
        reader.readAsDataURL(blob);
      });
    })().catch((error) => {
      fontPromise = undefined;
      throw error;
    });
  }
  return fontPromise;
}

function createReportPdf(prosthesis: ProsthesisReport, period: ReportPeriod, fontBase64: string): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", format: "a4", putOnlyUsedFonts: true });
  doc.addFileToVFS("NotoSans-Regular.ttf", fontBase64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.setFont("NotoSans", "normal");
  doc.setProperties({ title: "Отчёт о работе протезов", author: "BionicPRO" });

  doc.setFontSize(10);
  doc.setTextColor(37, 99, 235);
  doc.text("BionicPRO", 14, 12);
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  doc.text("Отчёт о работе протезов", 14, 23);
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`Период: ${period.from ?? "с начала наблюдений"} - ${period.to}`, 14, 32);
  doc.setFontSize(14);
  doc.setTextColor(17, 24, 39);
  const modelLines: string[] = doc.splitTextToSize(prosthesis.prosthesis_model, 269);
  doc.text(modelLines, 14, 43);
  const detailsY = 43 + modelLines.length * 6;
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  const detailsLines: string[] = doc.splitTextToSize(
    `Серийный номер: ${prosthesis.serial_number}. Записей: ${prosthesis.rows.length}.`, 269,
  );
  doc.text(detailsLines, 14, detailsY);

  autoTable(doc, {
    startY: detailsY + detailsLines.length * 5 + 5,
    margin: { top: 22, bottom: 16, left: 14, right: 14 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    theme: "striped",
    styles: { font: "NotoSans", fontStyle: "normal", fontSize: 9, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fontStyle: "normal", fillColor: [37, 99, 235], textColor: 255 },
    alternateRowStyles: { fillColor: [243, 246, 250] },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 36 },
      2: { cellWidth: 36 },
      3: { cellWidth: 69 },
      4: { cellWidth: 67 },
      5: { cellWidth: 27 },
    },
    head: [[...REPORT_TABLE_HEADERS]],
    body: prosthesis.rows.map((row) => [
      row.report_date,
      row.measurements,
      row.movements_total,
      `${row.avg_reaction_ms} / ${row.max_reaction_ms}`,
      `${row.battery_avg} / ${row.battery_min}`,
      row.errors_total,
    ]),
    willDrawPage: ({ pageNumber }) => {
      if (pageNumber > 1) {
        doc.setFont("NotoSans", "normal");
        doc.setFontSize(10);
        doc.setTextColor(75, 85, 99);
        doc.text("BionicPRO - Отчёт о работе протезов", 14, 13);
      }
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(`Страница ${page} из ${pageCount}`, 283, 201, { align: "right" });
  }
  return doc;
}

export async function createReportPdfBlob(prosthesis: ProsthesisReport, period: ReportPeriod): Promise<Blob> {
  return createReportPdf(prosthesis, period, await loadFont()).output("blob");
}
