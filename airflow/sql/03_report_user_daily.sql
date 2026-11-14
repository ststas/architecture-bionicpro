-- Витрина отчётов: одна строка на пользователя, протез и день.
-- Сервис отчётов читает её простым SELECT по пользователю и периоду.
--
-- Ключ сортировки начинается с customer_id: строки одного клиента лежат рядом,
-- и ClickHouse находит их по первичному индексу, не сканируя таблицу.
-- customer_id — идентификатор клиента в CRM; сервис отчётов получает его из токена Keycloak.
CREATE TABLE IF NOT EXISTS report_user_daily
(
    customer_id       UInt32,
    customer_name     String,
    prosthesis_id     UInt32,
    prosthesis_model  LowCardinality(String),
    serial_number     String,
    report_date       Date,
    measurements      UInt32,   -- число записей телеметрии за день
    movements_total   UInt64,   -- распознанных движений за день
    avg_reaction_ms   Float32,  -- среднее время реакции, мс
    max_reaction_ms   Float32,  -- худшее время реакции за день, мс
    battery_min       UInt8,    -- минимальный заряд батареи, %
    battery_avg       Float32,  -- средний заряд батареи, %
    errors_total      UInt32,   -- ошибок распознавания за день
    loaded_at         DateTime('UTC') DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(report_date)
ORDER BY (customer_id, report_date, prosthesis_id)
