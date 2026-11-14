"""Один раз фиксирует начало расписания по первой дате тестовой телеметрии."""

from airflow.models import Variable
from airflow.providers.postgres.hooks.postgres import PostgresHook

START_DATE_VARIABLE = "reports_etl_start_date"


def bootstrap_reports() -> str:
    existing = Variable.get(START_DATE_VARIABLE, default_var=None)
    if existing is not None:
        print(f"{START_DATE_VARIABLE} уже задана: {existing}")
        return existing

    (first_day,) = PostgresHook(postgres_conn_id="telemetry_db").get_first(
        "SELECT min((recorded_at AT TIME ZONE 'UTC')::date) FROM telemetry"
    )
    if first_day is None:
        raise RuntimeError("Тестовая телеметрия отсутствует: сначала инициализируйте telemetry_db")

    start_date = first_day.isoformat()
    Variable.set(START_DATE_VARIABLE, start_date)
    print(f"{START_DATE_VARIABLE} задана по источнику: {start_date}")
    return start_date


if __name__ == "__main__":
    bootstrap_reports()
