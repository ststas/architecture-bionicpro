-- Заглушка CRM: клиенты и их протезы.
-- customers.id совпадают с атрибутом customer_id пользователей prothetic1..3 в keycloak/realm-export.json.

CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    country     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prostheses (
    id             INTEGER PRIMARY KEY,
    customer_id    INTEGER NOT NULL REFERENCES customers (id),
    model          TEXT NOT NULL,
    serial_number  TEXT NOT NULL UNIQUE,
    issued_at      DATE NOT NULL
);

INSERT INTO customers (id, email, first_name, last_name, country) VALUES
    (1, 'prothetic1@example.com', 'Prothetic', 'One',   'RU'),
    (2, 'prothetic2@example.com', 'Prothetic', 'Two',   'RU'),
    (3, 'prothetic3@example.com', 'Prothetic', 'Three', 'RU');

-- У второго клиента два протеза.
INSERT INTO prostheses (id, customer_id, model, serial_number, issued_at) VALUES
    (101, 1, 'BionicHand X1', 'BH-X1-000101', DATE '2025-03-10'),
    (102, 2, 'BionicHand X1', 'BH-X1-000102', DATE '2025-05-22'),
    (103, 2, 'BionicArm Pro', 'BA-PR-000103', DATE '2026-01-15'),
    (104, 3, 'BionicArm Pro', 'BA-PR-000104', DATE '2026-02-03');
