import { createClient } from "@clickhouse/client";
import { config } from "./config";

export const clickhouse = createClient({
  url: config.clickhouse.url,
  username: config.clickhouse.username,
  password: config.clickhouse.password,
  database: config.clickhouse.database,
  clickhouse_settings: {
    // UInt64 по умолчанию приходит в JSON строкой; в отчёте нужны числа.
    output_format_json_quote_64bit_integers: 0,
  },
});
