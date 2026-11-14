/** Настройки сервиса из переменных окружения (значения по умолчанию — для локального стенда). */
export const config = {
  port: Number(process.env.PORT ?? 8000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  clickhouse: {
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER ?? "bionicpro",
    password: process.env.CLICKHOUSE_PASSWORD ?? "bionicpro_password",
    database: process.env.CLICKHOUSE_DB ?? "bionicpro",
  },

  keycloak: {
    // Issuer — адрес Keycloak, каким его видит браузер: он записан в claim `iss` токена.
    issuer: process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/reports-realm",
    // Ключи сервис забирает по внутреннему адресу Keycloak в сети Docker.
    jwksUrl:
      process.env.KEYCLOAK_JWKS_URL ??
      "http://localhost:8080/realms/reports-realm/protocol/openid-connect/certs",
    // Клиент, которому выдан токен (claim `azp`).
    clientId: process.env.KEYCLOAK_CLIENT_ID ?? "reports-frontend",
    requiredRole: process.env.REQUIRED_ROLE ?? "prothetic_user",
  },
};
