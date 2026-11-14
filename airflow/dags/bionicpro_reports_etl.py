"""ETL отчётности BionicPRO.

Раз в день переносит данные CRM и телеметрию протезов из PostgreSQL в ClickHouse
и собирает витрину report_user_daily, из которой сервис отчётов отдаёт отчёты.

Каждый запуск обрабатывает один завершённый день — свой data interval.
Все задачи идемпотентны: повторный запуск за тот же день не дублирует строки.
"""

from __future__ import annotations

from pathlib import Path

import clickhouse_connect
import pendulum
from airflow.decorators import dag, task
from airflow.hooks.base import BaseHook
from airflow.models import Variable
from airflow.providers.postgres.hooks.postgres import PostgresHook

SQL_DIR = Path("/opt/airflow/sql")

# Удаление в ClickHouse — фоновая мутация; mutations_sync=2 заставляет дождаться её завершения,
# чтобы вставка шла уже после удаления.
SYNC_MUTATION = {"mutations_sync": 2}


def clickhouse_client():
    """Клиент ClickHouse по подключению Airflow `clickhouse` (Admin -> Connections)."""
    conn = BaseHook.get_connection("clickhouse")
    return clickhouse_connect.get_client(
        host=conn.host,
        port=conn.port,
        username=conn.login,
        password=conn.password,
        database=conn.schema,
    )


@dag(
    dag_id="bionicpro_reports_etl",
    description="CRM и телеметрия -> ClickHouse -> витрина отчётов report_user_daily",
    schedule="@daily",
    # airflow-init фиксирует первую дату источника (день первого запуска минус 10 дней).
    # Значение сохраняется в БД Airflow и не сдвигается при каждом разборе DAG.
    start_date=pendulum.parse(Variable.get("reports_etl_start_date"), tz="UTC"),
    catchup=True,  # дозагрузить уже прошедшие дни
    max_active_runs=1,  # дни обрабатываются по очереди
    default_args={"retries": 1, "retry_delay": pendulum.duration(minutes=1)},
    tags=["bionicpro", "reports"],
)
def bionicpro_reports_etl():
    @task
    def create_tables() -> None:
        """Создаёт таблицы ClickHouse, если их ещё нет (DDL лежит в airflow/sql)."""
        client = clickhouse_client()
        for ddl_file in sorted(SQL_DIR.glob("*.sql")):
            client.command(ddl_file.read_text(encoding="utf-8"))

    @task
    def load_crm() -> int:
        """Выгружает клиентов и их протезы из CRM. Таблица перезаписывается целиком."""
        rows = PostgresHook(postgres_conn_id="crm_db").get_records(
            """
            SELECT c.id, c.email, c.first_name, c.last_name, c.country,
                   p.id, p.model, p.serial_number
            FROM customers c
            JOIN prostheses p ON p.customer_id = c.id
            """
        )
        client = clickhouse_client()
        client.command("TRUNCATE TABLE crm_customers")
        if rows:
            client.insert(
                "crm_customers",
                rows,
                column_names=[
                    "customer_id", "email", "first_name", "last_name", "country",
                    "prosthesis_id", "prosthesis_model", "serial_number",
                ],
            )
        return len(rows)

    @task
    def load_telemetry(data_interval_start=None, data_interval_end=None) -> int:
        """Выгружает телеметрию за обрабатываемый день."""
        rows = PostgresHook(postgres_conn_id="telemetry_db").get_records(
            """
            SELECT prosthesis_id, recorded_at, movements_count,
                   avg_reaction_ms::float8, battery_level, error_count
            FROM telemetry
            WHERE recorded_at >= %(start)s AND recorded_at < %(end)s
            """,
            parameters={"start": data_interval_start, "end": data_interval_end},
        )
        client = clickhouse_client()
        # Идемпотентность: сначала удаляем уже загруженные строки этого дня.
        client.command(
            "ALTER TABLE telemetry_raw DELETE WHERE toDate(recorded_at) = {day:Date}",
            parameters={"day": data_interval_start.date()},
            settings=SYNC_MUTATION,
        )
        if rows:
            client.insert(
                "telemetry_raw",
                rows,
                column_names=[
                    "prosthesis_id", "recorded_at", "movements_count",
                    "avg_reaction_ms", "battery_level", "error_count",
                ],
            )
        return len(rows)

    @task
    def build_mart(data_interval_start=None) -> int:
        """Собирает витрину за день: агрегаты телеметрии по клиенту и протезу плюс данные CRM."""
        day = data_interval_start.date()
        client = clickhouse_client()
        # Идемпотентность: пересобираем день с нуля.
        client.command(
            "ALTER TABLE report_user_daily DELETE WHERE report_date = {day:Date}",
            parameters={"day": day},
            settings=SYNC_MUTATION,
        )
        client.command(
            """
            INSERT INTO report_user_daily
                (customer_id, customer_name, prosthesis_id, prosthesis_model,
                 serial_number, report_date, measurements, movements_total,
                 avg_reaction_ms, max_reaction_ms, battery_min, battery_avg, errors_total)
            SELECT
                c.customer_id,
                concat(c.first_name, ' ', c.last_name),
                t.prosthesis_id,
                c.prosthesis_model,
                c.serial_number,
                toDate(t.recorded_at) AS report_date,
                count(),
                sum(t.movements_count),
                avg(t.avg_reaction_ms),
                max(t.avg_reaction_ms),
                min(t.battery_level),
                avg(t.battery_level),
                sum(t.error_count)
            FROM telemetry_raw AS t
            INNER JOIN crm_customers AS c ON c.prosthesis_id = t.prosthesis_id
            WHERE toDate(t.recorded_at) = {day:Date}
            GROUP BY
                c.customer_id, c.first_name, c.last_name,
                t.prosthesis_id, c.prosthesis_model, c.serial_number, report_date
            """,
            parameters={"day": day},
        )
        return int(
            client.command(
                "SELECT count() FROM report_user_daily WHERE report_date = {day:Date}",
                parameters={"day": day},
            )
        )

    create_tables() >> [load_crm(), load_telemetry()] >> build_mart()


bionicpro_reports_etl()
