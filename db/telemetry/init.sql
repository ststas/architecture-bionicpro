-- Заглушка базы телеметрии: показания протезов.
-- prosthesis_id совпадает с prostheses.id в заглушке CRM.

CREATE TABLE telemetry (
    id                BIGSERIAL PRIMARY KEY,
    prosthesis_id     INTEGER NOT NULL,
    recorded_at       TIMESTAMPTZ NOT NULL,
    movements_count   INTEGER NOT NULL,           -- распознанных движений за интервал
    avg_reaction_ms   NUMERIC(6, 2) NOT NULL,     -- среднее время реакции, мс
    battery_level     SMALLINT NOT NULL,          -- заряд батареи, %
    error_count       INTEGER NOT NULL            -- ошибок распознавания за интервал
);

CREATE INDEX telemetry_recorded_at_idx ON telemetry (recorded_at);

-- Тестовые данные: одна запись в час на каждый протез
-- с начала суток 10 дней назад до текущего момента (сегодняшний день неполный).
SELECT setseed(0.42);

INSERT INTO telemetry (prosthesis_id, recorded_at, movements_count, avg_reaction_ms, battery_level, error_count)
SELECT
    p.id,
    ts,
    (20 + random() * 180)::INTEGER,
    round((60 + random() * 60)::NUMERIC, 2),
    (100 - extract(hour FROM ts) * 3 - random() * 10)::SMALLINT,
    (random() * 4)::INTEGER
FROM unnest(ARRAY[101, 102, 103, 104]) AS p (id)
CROSS JOIN generate_series(
    date_trunc('day', now()) - INTERVAL '10 days',
    now(),
    INTERVAL '1 hour'
) AS ts;
