import { Request, Response, Router } from "express";
import type { ProsthesisReport, ReportAvailability, ReportErrorResponse, ReportResponse, ReportRow } from "@bionicpro/contracts";
import { requireUser } from "./auth";
import { clickhouse } from "./clickhouse";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Плоская строка ClickHouse; публичный ответ группируется по протезам. */
type MartRow = ReportRow & Omit<ProsthesisReport, "rows">;

/** Возвращает дату в формате YYYY-MM-DD или null, если строка датой не является. */
function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

async function getAvailability(customerId: number): Promise<ReportAvailability> {
  const result = await clickhouse.query({
    query: `SELECT minOrNull(report_date) AS data_available_from,
                   maxOrNull(report_date) AS data_available_until
            FROM report_user_daily
            WHERE customer_id = {customer_id: UInt32}`,
    query_params: { customer_id: customerId },
    format: "JSONEachRow",
  });
  const [availability] = await result.json<ReportAvailability>();
  return availability ?? { data_available_from: null, data_available_until: null };
}

export const reportsRouter = Router();

reportsRouter.get("/reports/availability", requireUser, async (req: Request, res: Response<ReportAvailability | ReportErrorResponse>) => {
  try {
    res.set("Cache-Control", "no-store").json(await getAvailability(req.user!.customerId));
  } catch (err) {
    console.error("Не удалось получить доступный период из ClickHouse:", err);
    res.status(502).json({ error: "olap_unavailable", message: "Хранилище отчётов недоступно" });
  }
});

/**
 * GET /reports?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Отчёт о работе протезов текущего пользователя за период.
 * Данные читаются из готовой витрины простым SELECT, без вычислений на лету.
 */
reportsRouter.get("/reports", requireUser, async (req: Request, res: Response<ReportResponse | ReportErrorResponse>) => {
  res.set("Cache-Control", "no-store");
  const requestedFrom = req.query.from === undefined ? undefined : parseDate(req.query.from);
  const requestedTo = req.query.to === undefined ? undefined : parseDate(req.query.to);
  if (requestedFrom === null || requestedTo === null) {
    res.status(400).json({ error: "bad_request", message: "Параметры from и to — даты в формате YYYY-MM-DD" });
    return;
  }
  if (requestedFrom && requestedTo && requestedFrom > requestedTo) {
    res.status(400).json({ error: "bad_request", message: "Дата from не может быть позже to" });
    return;
  }

  try {
    // Проверяем границы заново: метаданные в открытом браузере могли устареть.
    const availability = await getAvailability(req.user!.customerId);
    const { data_available_from: availableFrom, data_available_until: availableTo } = availability;
    if (!availableFrom || !availableTo) {
      res.json({ customer_id: req.user!.customerId, ...availability, period: null,
        period_truncated: false, status: "no_data", prostheses: [] });
      return;
    }
    const from = requestedFrom && requestedFrom > availableFrom ? requestedFrom : availableFrom;
    const to = requestedTo && requestedTo < availableTo ? requestedTo : availableTo;
    const periodTruncated = Boolean(
      (requestedFrom && requestedFrom < availableFrom) || (requestedTo && requestedTo > availableTo) || from > to,
    );
    if (from > to) {
      res.json({ customer_id: req.user!.customerId, ...availability, period: null,
        period_truncated: periodTruncated, status: "period_unavailable", prostheses: [] });
      return;
    }
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
        ORDER BY prosthesis_id, report_date`,
      // Значения передаются параметрами, а не подставляются в текст запроса.
      // customer_id берётся только из токена: запросить чужой отчёт параметром нельзя.
      query_params: { customer_id: req.user!.customerId, from, to },
      format: "JSONEachRow",
    });
    const rows = await result.json<MartRow>();
    const prostheses = new Map<number, ProsthesisReport>();
    for (const { prosthesis_id, prosthesis_model, serial_number, ...dailyRow } of rows) {
      let prosthesis = prostheses.get(prosthesis_id);
      if (!prosthesis) {
        prosthesis = { prosthesis_id, prosthesis_model, serial_number, rows: [] };
        prostheses.set(prosthesis_id, prosthesis);
      }
      prosthesis.rows.push(dailyRow);
    }

    res.json({
      customer_id: req.user!.customerId,
      ...availability,
      period: { from, to },
      period_truncated: periodTruncated,
      status: rows.length ? "ok" : "no_data",
      prostheses: [...prostheses.values()],
    });
  } catch (err) {
    console.error("Не удалось получить отчёт из ClickHouse:", err);
    res.status(502).json({ error: "olap_unavailable", message: "Хранилище отчётов недоступно" });
  }
});
