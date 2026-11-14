-- Сырая выгрузка CRM: клиент и его протез (одна строка на протез).
-- Таблица небольшая и перезаписывается целиком при каждом запуске DAG.
CREATE TABLE IF NOT EXISTS crm_customers
(
    customer_id       UInt32,
    email             String,
    first_name        String,
    last_name         String,
    country           LowCardinality(String),
    prosthesis_id     UInt32,
    prosthesis_model  LowCardinality(String),
    serial_number     String,
    loaded_at         DateTime('UTC') DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (customer_id, prosthesis_id)
