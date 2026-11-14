import type { ReportAvailability, ReportErrorResponse, ReportQuery, ReportResponse } from "@bionicpro/contracts";

export class ReportRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ReportRequestError";
  }
}

async function requestReport<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${process.env.REACT_APP_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const error: ReportErrorResponse | null = await response.json().catch(() => null);
    throw new ReportRequestError(response.status, error?.message ?? "Не удалось получить отчёт");
  }
  return response.json();
}

export function getReportAvailability(token: string): Promise<ReportAvailability> {
  return requestReport<ReportAvailability>("/reports/availability", token);
}

export function getReport(token: string, query: ReportQuery): Promise<ReportResponse> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);

  return requestReport<ReportResponse>(`/reports?${params}`, token);
}
