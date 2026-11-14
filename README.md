# Проектная работа 9 спринта: кейс "BionicPro"

## Задание 1. Повышение безопасности системы

### Задача 1

Архитектурное решение для управления учётными данными пользователя.
Диаграмма: [task1/BionicPRO_C4_model_task1.drawio](task1/BionicPRO_C4_model_task1.drawio).

**Единый IdP.** Все приложения BionicPRO (приложение для донастройки, интернет-магазин, CRM, API) аутентифицируют пользователей через один Keycloak по OIDC. Пользователь входит один раз (SSO), а API проверяет подпись токена по публичным ключам Keycloak (JWKS).

**Учётные записи остаются в стране представительства.** Keycloak не хранит учётные записи у себя, а читает их из LDAP-каталога, расположенного в стране представительства (User Federation). Данные не копируются в центральное хранилище, поэтому принцип локального хранения персональной и медицинской информации не нарушается. Для новой страны подключается её собственный каталог.

**Токены не попадают на фронтенд.** Между фронтендом и Keycloak стоит BFF-сервис `bionicpro-auth`. Он сам проходит Authorization Code Flow с PKCE, обменивает код на токены и хранит access- и refresh-токены на сервере в Redis. Браузер получает только HttpOnly-cookie с идентификатором сессии. Запросы к API идут через BFF: он подставляет access-токен из сессии. При обновлении access-токена BFF получает новый refresh-токен, а старый перестаёт действовать (ротация).

**Внешние удостоверяющие службы.** Вход через удостоверяющие службы разных стран подключается в Keycloak как Identity Brokering по OIDC или SAML. Приложения при этом работают только с Keycloak, и добавление нового провайдера не требует их изменения.

### Задача 2

Authorization Code Grant заменён на Authorization Code Flow с PKCE.

- **Keycloak** ([keycloak/realm-export.json](keycloak/realm-export.json)), клиент `reports-frontend`: атрибут `pkce.code.challenge.method = S256` делает PKCE обязательным — запрос авторизации без `code_challenge` отклоняется. Отключены implicit flow и direct access grants, чтобы токен нельзя было получить в обход PKCE.
- **Фронтенд** ([frontend/src/App.tsx](frontend/src/App.tsx)): `keycloak-js` инициализируется с `pkceMethod: 'S256'` — генерирует `code_verifier`, отправляет `code_challenge` при входе и предъявляет `code_verifier` при обмене кода на токены.
- **Вызов API** ([frontend/src/components/ReportPage.tsx](frontend/src/components/ReportPage.tsx)): перед запросом access-токен обновляется через `keycloak.updateToken()`; если обновить не удалось, пользователь отправляется на повторный вход.

Realm импортируется только в пустую базу Keycloak, поэтому для применения настроек нужно удалить каталог `postgres-keycloak-data` и перезапустить `docker compose up`.

## Задание 2. Разработка сервиса отчётов

### Задача 1

Архитектура подготовки и получения отчётов.
Диаграмма: [task2/BionicPRO_C4_model_task2.drawio](task2/BionicPRO_C4_model_task2.drawio).

- **ETL.** Airflow раз в день читает клиентов из CRM DB и телеметрию из PostgreSQL, записывает их в ClickHouse и собирает витрину `report_user_daily` — агрегаты телеметрии по клиенту и дню.
- **Отдельный сервис отчётов.** Отчёты отдаёт Reports API, а не существующий API: тот занят приёмом телеметрии, и нагрузки не должны влиять друг на друга.
- **Получение отчёта.** Reports API (`GET /reports`) проверяет токен по ключам Keycloak, определяет пользователя по токену и читает из витрины только его строки простым запросом, без вычислений на лету.

### Задача 2

Airflow DAG и окружение для него.

**Окружение.** В [docker-compose.yaml](docker-compose.yaml) добавлены сервисы для отчётности:

- `crm_db` и `telemetry_db` — заглушки источников на PostgreSQL с тестовыми данными ([db/crm/init.sql](db/crm/init.sql), [db/telemetry/init.sql](db/telemetry/init.sql)). Идентификаторы клиентов совпадают с атрибутом `customer_id` пользователей `prothetic1..3` в Keycloak; телеметрия сгенерирована за 10 дней до момента первого запуска.
- `clickhouse` — OLAP-база `bionicpro`, порт 8123.
- `airflow-scheduler`, `airflow-webserver`, `airflow_db` — Airflow с LocalExecutor и своей PostgreSQL; интерфейс на http://localhost:8081 (admin / admin). Подключения `crm_db`, `telemetry_db` и `clickhouse` создаются при инициализации и видны в интерфейсе: Admin → Connections.

**DAG.** [airflow/dags/bionicpro_reports_etl.py](airflow/dags/bionicpro_reports_etl.py), расписание `@daily`. Каждый запуск обрабатывает один завершённый день:

1. `create_tables` — создаёт таблицы ClickHouse по DDL из [airflow/sql](airflow/sql).
2. `load_crm` — выгружает клиентов и их протезы из CRM в `crm_customers`.
3. `load_telemetry` — выгружает телеметрию за день в `telemetry_raw`.
4. `build_mart` — собирает витрину `report_user_daily`: агрегаты телеметрии за день по клиенту и протезу, объединённые с данными CRM.

**Витрина.** Одна строка на пользователя, протез и день. Ключ сортировки `(customer_id, report_date, prosthesis_id)` даёт быстрый доступ к строкам одного клиента; партиции — по месяцам.

**Связь пользователя с клиентом CRM.** У пользователя Keycloak есть атрибут `customer_id` — идентификатор клиента в CRM. Маппер клиента `reports-frontend` кладёт его в access-токен, поэтому связь подписана Keycloak и не зависит от данных CRM и ETL. Атрибут закрыт от изменения самим пользователем.

**Идемпотентность.** Перед загрузкой задача удаляет строки своего дня, поэтому повторный запуск не создаёт дублей.

**Как посмотреть результат.**

- Запуски DAG — в интерфейсе Airflow: http://localhost:8081 (admin / admin), DAG `bionicpro_reports_etl`.
- Витрина — в веб-интерфейсе ClickHouse: http://localhost:8123/play, пользователь `bionicpro`, пароль `bionicpro_password`, запрос:

```sql
SELECT * FROM bionicpro.report_user_daily ORDER BY customer_id, report_date, prosthesis_id
```
