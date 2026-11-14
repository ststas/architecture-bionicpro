/** Показатели одного протеза за один день. */
export interface ReportRow {
  report_date: string;
  measurements: number;
  movements_total: number;
  avg_reaction_ms: number;
  max_reaction_ms: number;
  battery_min: number;
  battery_avg: number;
  errors_total: number;
}

export interface ProsthesisReport {
  prosthesis_id: number;
  prosthesis_model: string;
  serial_number: string;
  rows: ReportRow[];
}

export interface ReportPeriod {
  from: string;
  to: string;
}

/** Границы строк текущего пользователя, уже доступных в витрине. */
export interface ReportAvailability {
  data_available_from: string | null;
  data_available_until: string | null;
}

/** Даты в формате YYYY-MM-DD. Владелец отчёта определяется только токеном. */
export interface ReportQuery {
  from?: string;
  to?: string;
}

export interface ReportResponse extends ReportAvailability {
  customer_id: number;
  period: ReportPeriod | null;
  period_truncated: boolean;
  status: "ok" | "no_data" | "period_unavailable";
  prostheses: ProsthesisReport[];
}

export type ReportErrorCode = "unauthorized" | "forbidden" | "bad_request" | "olap_unavailable";

export interface ReportErrorResponse {
  error: ReportErrorCode;
  message: string;
}
