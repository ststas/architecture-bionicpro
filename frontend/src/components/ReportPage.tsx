import React, { useCallback, useEffect, useState } from "react";
import { useKeycloak } from "@react-keycloak/web";
import type { ProsthesisReport, ReportAvailability, ReportResponse } from "@bionicpro/contracts";
import { getReport, getReportAvailability, ReportRequestError } from "../api/reports";
import { createReportCsv } from "../reports/csv";
import { downloadBlob, reportFilename } from "../reports/download";
import type { ReportFormat } from "../reports/download";
import ProsthesisReportTable from "./ProsthesisReportTable";

const ReportPage: React.FC = () => {
  const { keycloak, initialized } = useKeycloak();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [availability, setAvailability] = useState<ReportAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [exporting, setExporting] = useState<{ prosthesisId: number; format: ReportFormat } | null>(null);
  const busy = loading || availabilityLoading || exporting !== null;
  const hasAvailableData = Boolean(availability?.data_available_from && availability?.data_available_until);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ReportRequestError && err.status === 401) {
      setError("Сессия истекла или недействительна. Войдите снова.");
      setNeedsLogin(true);
    } else if (err instanceof ReportRequestError && err.status === 403) {
      setError("Нет доступа к отчётам. Они доступны пользователям протезов с привязанной учётной записью клиента.");
    } else {
      setError(err instanceof ReportRequestError ? err.message : "Не удалось связаться с сервисом отчётов. Попробуйте ещё раз.");
    }
  }, []);

  useEffect(() => {
    setReport(null);
    setAvailability(null);
    if (!initialized || !keycloak.authenticated) return;
    let active = true;
    setAvailabilityLoading(true);
    setError(null);
    setNeedsLogin(false);
    (async () => {
      try {
        try {
          await keycloak.updateToken(30);
        } catch {
          throw new ReportRequestError(401, "Сессия истекла");
        }
        if (!keycloak.token) throw new ReportRequestError(401, "Требуется вход");
        const result = await getReportAvailability(keycloak.token);
        if (active) setAvailability(result);
      } catch (err) {
        if (active) handleError(err);
      } finally {
        if (active) setAvailabilityLoading(false);
      }
    })();
    return () => { active = false; };
  }, [initialized, keycloak, keycloak.authenticated, availabilityAttempt, handleError]);

  const loadReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReport(null);
    setError(null);
    setNeedsLogin(false);
    if (from && to && from > to) {
      setError("Дата начала не может быть позже даты окончания.");
      return;
    }
    try {
      setLoading(true);
      if (!keycloak.authenticated) {
        throw new ReportRequestError(401, "Требуется вход");
      }

      // Обновляем access-токен, если он истекает в ближайшие 30 секунд.
      try {
        await keycloak.updateToken(30);
      } catch {
        throw new ReportRequestError(401, "Сессия истекла");
      }
      if (!keycloak.token) throw new ReportRequestError(401, "Требуется вход");
      const result = await getReport(keycloak.token, {
        from: from || undefined,
        to: to || undefined,
      });
      setReport(result);
      setAvailability({ data_available_from: result.data_available_from, data_available_until: result.data_available_until });
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = async (prosthesis: ProsthesisReport, format: ReportFormat) => {
    if (!report?.period || !prosthesis.rows.length || busy) return;
    setExporting({ prosthesisId: prosthesis.prosthesis_id, format });
    setError(null);
    try {
      const blob = format === "csv"
        ? new Blob([createReportCsv(prosthesis)], { type: "text/csv;charset=utf-8" })
        : await (await import("../reports/pdf")).createReportPdfBlob(prosthesis, report.period);
      downloadBlob(blob, reportFilename(prosthesis, report.period, format));
    } catch {
      setError(`Не удалось сформировать ${format.toUpperCase()}. Попробуйте скачать отчёт ещё раз.`);
    } finally {
      setExporting(null);
    }
  };

  if (!initialized) {
    return (
      <div className="p-8" role="status">
        Загрузка…
      </div>
    );
  }

  if (!keycloak.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
        <button
          onClick={() => keycloak.login()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Войти
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <section
        className="mx-auto max-w-6xl p-6 bg-white rounded-lg shadow-md"
        aria-labelledby="reports-title"
      >
        <h1 id="reports-title" className="text-2xl font-bold mb-2">
          Отчёт о работе протезов
        </h1>
        <p className="text-gray-600 mb-6">
          Выберите период или оставьте даты пустыми, чтобы получить все
          доступные данные.
        </p>

        {availabilityLoading && <p role="status" className="mb-4">Загрузка доступного периода…</p>}
        {hasAvailableData && (
          <p className="mb-4 text-gray-600">Данные доступны с {availability!.data_available_from} по {availability!.data_available_until}.</p>
        )}
        {availability && !hasAvailableData && (
          <p role="status" className="mb-4">Данные отчётов пока не подготовлены.</p>
        )}
        {!hasAvailableData && !availabilityLoading && (availability || error) && !needsLogin && (
          <button onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)} className="mb-4 text-blue-700 underline">
            Обновить доступный период
          </button>
        )}

        <form onSubmit={loadReport} className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            С
            <input
              type="date"
              value={from}
              min={availability?.data_available_from ?? undefined}
              max={availability?.data_available_until ?? undefined}
              onChange={(event) => setFrom(event.target.value)}
              disabled={busy || !hasAvailableData}
              className="border rounded px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            По
            <input
              type="date"
              value={to}
              min={availability?.data_available_from ?? undefined}
              max={availability?.data_available_until ?? undefined}
              onChange={(event) => setTo(event.target.value)}
              disabled={busy || !hasAvailableData}
              className="border rounded px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !hasAvailableData}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Загрузка отчёта…" : "Получить отчёт"}
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-4 p-4 bg-red-100 text-red-700 rounded"
          >
            {error}
            {needsLogin && (
              <button
                onClick={() => keycloak.login()}
                className="ml-3 underline"
              >
                Войти снова
              </button>
            )}
          </div>
        )}
        {report?.period_truncated && report.period && (
          <p role="status" className="mt-4 p-4 bg-blue-50 text-blue-900 rounded">
            Период ограничен доступными данными: {report.period.from} — {report.period.to}.
          </p>
        )}
        {report && report.prostheses.length === 0 && (
          <p
            role="status"
            className="mt-6 p-4 bg-blue-50 text-blue-900 rounded"
          >
            {report.status === "period_unavailable"
              ? "Выбранный период вне доступного диапазона. Отчёт за него пока недоступен."
              : "За выбранный период данных пока нет."}
          </p>
        )}
        {report?.period && report.prostheses.length > 0 && (
          <div className="mt-6">
            <p role="status">
              Период: {report.period.from ?? "все данные"} — {report.period.to}.
              Протезов: {report.prostheses.length}.
            </p>
            {report.prostheses.map((prosthesis) => (
              <ProsthesisReportTable
                key={prosthesis.prosthesis_id}
                prosthesis={prosthesis}
                disabled={busy}
                exporting={exporting?.prosthesisId === prosthesis.prosthesis_id ? exporting.format : null}
                onDownload={(format) => downloadReport(prosthesis, format)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ReportPage;
