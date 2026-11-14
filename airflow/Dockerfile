FROM apache/airflow:2.10.5-python3.11

# Клиент ClickHouse для DAG; провайдер Postgres уже есть в базовом образе.
RUN pip install --no-cache-dir clickhouse-connect==0.8.15
