-- Сырая телеметрия протезов, выгружается из PostgreSQL по одному дню за запуск.
CREATE TABLE IF NOT EXISTS telemetry_raw
(
    prosthesis_id    UInt32,
    recorded_at      DateTime('UTC'),
    movements_count  UInt32,
    avg_reaction_ms  Float32,
    battery_level    UInt8,
    error_count      UInt32,
    loaded_at        DateTime('UTC') DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(recorded_at)
ORDER BY (prosthesis_id, recorded_at)
