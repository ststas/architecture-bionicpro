import { Request, Response, Router } from "express";
import { requireUser } from "./auth";
import { clickhouse } from "./clickhouse";

/** Строка отчёта: показатели одного протеза за один день. */
interface ReportRow {
  report_date: string;
  prosthesis_id: number;
  prosthesis_model: string;
  serial_number: string;
  measurements: number;
  movements_total: number;
  avg_reaction_ms: number;
  max_reaction_ms: number;
  battery_min: number;
  battery_avg: number;
  errors_total: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Возвращает дату в формате YYYY-MM-DD или null, если строка датой не является. */
function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export const reportsRouter = Router();

/**
 * GET /reports?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Отчёт о работе протезов текущего пользователя за период.
 * Данные читаются из готовой витрины простым SELECT, без вычислений на лету.
 */
reportsRouter.get("/reports", requireUser, async (req: Request, res: Response) => {
  const from = req.query.from === undefined ? "1970-01-01" : parseDate(req.query.from);
  const to = req.query.to === undefined ? today() : parseDate(req.query.to);
  if (!from || !to) {
    res.status(400).json({ error: "bad_request", message: "Параметры from и to — даты в формате YYYY-MM-DD" });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: "bad_request", message: "Дата from не может быть позже to" });
    return;
  }

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
            report_date, prosthesis_id, prosthesis_model, serial_number,
            measurements, movements_total,
            round(avg_reaction_ms, 2) AS avg_reaction_ms,
            round(max_reaction_ms, 2) AS max_reaction_ms,
            battery_min,
            round(battery_avg, 1) AS battery_avg,
            errors_total
        FROM report_user_daily
        WHERE customer_id = {customer_id: UInt32}
          AND report_date BETWEEN {from: Date} AND {to: Date}
        ORDER BY report_date, prosthesis_id`,
      // Значения передаются параметрами, а не подставляются в текст запроса.
      // customer_id берётся только из токена: запросить чужой отчёт параметром нельзя.
      query_params: { customer_id: req.user!.customerId, from, to },
      format: "JSONEachRow",
    });
    const rows = await result.json<ReportRow>();

    res.json({
      customer_id: req.user!.customerId,
      period: { from: req.query.from === undefined ? null : from, to },
      rows,
    });
  } catch (err) {
    console.error("Не удалось получить отчёт из ClickHouse:", err);
    res.status(502).json({ error: "olap_unavailable", message: "Хранилище отчётов недоступно" });
  }
});
