const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const express = require("express");
const { exportJWK, generateKeyPair, SignJWT } = require("jose");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

test("GET /reports: проверка JWT и изоляция клиентов", async (t) => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const rogue = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const jwksServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const issuer = await listen(jwksServer);
  t.after(() => close(jwksServer));
  process.env.KEYCLOAK_ISSUER = issuer;
  process.env.KEYCLOAK_JWKS_URL = `${issuer}/certs`;
  process.env.KEYCLOAK_CLIENT_ID = "reports-frontend";
  process.env.REQUIRED_ROLE = "prothetic_user";

  // Реальные JWT, HTTP и JWKS; подменяем только чтение OLAP.
  const { clickhouse } = require("../dist/clickhouse");
  const calls = [];
  const martRow = (id, date = "2026-01-01", movements = 100) => ({
    prosthesis_id: id, prosthesis_model: `Model ${id}`, serial_number: `SN-${id}`,
    report_date: date, measurements: 24, movements_total: movements,
    avg_reaction_ms: 80, max_reaction_ms: 95, battery_min: 20, battery_avg: 60, errors_total: 0,
  });
  let fixtureRows;
  const originalQuery = clickhouse.query;
  clickhouse.query = async (options) => {
    calls.push(options);
    const rows = fixtureRows ?? [martRow(options.query_params.customer_id * 100)];
    if (options.query.includes("minOrNull")) {
      const dates = rows.map(row => row.report_date).sort();
      return { json: async () => [{ data_available_from: dates[0] ?? null, data_available_until: dates.at(-1) ?? null }] };
    }
    return { json: async () => rows.filter(row =>
      row.report_date >= options.query_params.from && row.report_date <= options.query_params.to) };
  };
  t.after(async () => {
    clickhouse.query = originalQuery;
    await clickhouse.close();
  });
  const { reportsRouter } = require("../dist/reports");
  const app = express();
  app.use(reportsRouter);
  const apiServer = http.createServer(app);
  const api = await listen(apiServer);
  t.after(() => close(apiServer));

  async function sign(overrides = {}, key = privateKey, alg = "RS256") {
    const payload = {
      iss: issuer,
      sub: "keycloak-user-1",
      exp: Math.floor(Date.now() / 1000) + 300,
      typ: "Bearer",
      azp: "reports-frontend",
      realm_access: { roles: ["prothetic_user"] },
      customer_id: 1,
      ...overrides,
    };
    return new SignJWT(payload).setProtectedHeader({ alg, kid: "test-key" }).sign(key);
  }

  async function request(authorization, path = "/reports") {
    const response = await fetch(`${api}${path}`, {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });
    return { status: response.status, body: await response.json() };
  }

  async function denied(name, status, authorization) {
    await t.test(name, async () => {
      const count = calls.length;
      for (const path of ["/reports", "/reports/availability"]) {
        const response = await request(authorization, path);
        assert.equal(response.status, status);
        assert.equal(response.body.error, status === 401 ? "unauthorized" : "forbidden");
      }
      assert.equal(calls.length, count, "Отказ в доступе должен происходить до обращения к OLAP");
    });
  }

  await denied("без токена", 401);
  await denied("неверная схема авторизации", 401, "Basic credentials");
  await denied("некорректный JWT", 401, "Bearer not-a-jwt");
  await denied("подпись чужим ключом", 401, `Bearer ${await sign({}, rogue.privateKey)}`);
  const valid = await sign();
  const parts = valid.split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  parts[1] = Buffer.from(JSON.stringify({ ...claims, customer_id: 2 })).toString("base64url");
  await denied("подмена customer_id без новой подписи", 401, `Bearer ${parts.join(".")}`);
  await denied("просроченный токен", 401, `Bearer ${await sign({ exp: 1 })}`);
  await denied("отсутствует exp", 401, `Bearer ${await sign({ exp: undefined })}`);
  await denied("отсутствует sub", 401, `Bearer ${await sign({ sub: undefined })}`);
  await denied("пустой sub", 401, `Bearer ${await sign({ sub: "" })}`);
  await denied("неверный issuer", 401, `Bearer ${await sign({ iss: "https://other.example" })}`);
  await denied("токен другого клиента", 401, `Bearer ${await sign({ azp: "other-client" })}`);
  await denied("токен ещё не действует", 401, `Bearer ${await sign({ nbf: claims.exp + 300 })}`);
  await denied("ID-токен", 401, `Bearer ${await sign({ typ: "ID" })}`);
  await denied("refresh-токен", 401, `Bearer ${await sign({ typ: "Refresh" })}`);
  await denied("неразрешённый алгоритм", 401,
    `Bearer ${await sign({}, Buffer.alloc(32, 1), "HS256")}`);

  for (const [name, realm_access] of [
    ["нет роли prothetic_user", { roles: ["user"] }],
    ["нет realm_access", undefined],
    ["realm_access равен null", null],
    ["roles — строка с подстрокой prothetic_user", { roles: "not_prothetic_user" }],
    ["roles — число", { roles: 42 }],
    ["roles содержит не только строки", { roles: ["prothetic_user", 1] }],
  ]) {
    await denied(name, 403, `Bearer ${await sign({ realm_access })}`);
  }
  for (const customer_id of [undefined, null, "1", 0, -1, 1.5, 4294967296]) {
    await denied(`недопустимый customer_id: ${customer_id}`, 403,
      `Bearer ${await sign({ customer_id })}`);
  }

  for (const customerId of [1, 2]) {
    await t.test(`клиент ${customerId} получает свой отчёт при подмене query-параметров`, async () => {
      const token = await sign({ customer_id: customerId, sub: `keycloak-user-${customerId}` });
      const response = await request(`Bearer ${token}`,
        "/reports?customer_id=3&customerId=3&user_id=3&from=2026-01-01&to=2026-01-31");
      assert.equal(response.status, 200);
      assert.equal(response.body.customer_id, customerId);
      const { prosthesis_id, prosthesis_model, serial_number, ...dailyRow } = martRow(customerId * 100);
      assert.deepEqual(response.body.prostheses, [{
        prosthesis_id, prosthesis_model, serial_number, rows: [dailyRow],
      }]);
      assert.equal("rows" in response.body, false);
      const query = calls.at(-1);
      assert.match(query.query, /WHERE\s+customer_id\s*=\s*\{customer_id:\s*UInt32\}/);
      assert.deepEqual(query.query_params, {
        customer_id: customerId, from: "2026-01-01", to: "2026-01-01",
      });
    });
  }
  await t.test("схема Bearer нечувствительна к регистру", async () => {
    assert.equal((await request(`bearer ${valid}`)).status, 200);
  });
  await t.test("два протеза: отдельные группы с показателями за каждый день", async (t) => {
    fixtureRows = [martRow(102), martRow(103), martRow(102, "2026-01-02", 200), martRow(103, "2026-01-02", 300)];
    t.after(() => { fixtureRows = undefined; });
    const response = await request(`Bearer ${valid}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.prostheses.length, 2);
    for (const [index, id] of [102, 103].entries()) {
      const group = response.body.prostheses[index];
      assert.equal(group.prosthesis_id, id);
      assert.equal(group.prosthesis_model, `Model ${id}`);
      assert.equal(group.serial_number, `SN-${id}`);
      assert.deepEqual(group.rows, fixtureRows.filter(row => row.prosthesis_id === id).map(row => {
        const { prosthesis_id, prosthesis_model, serial_number, ...dailyRow } = row;
        return dailyRow;
      }));
    }
  });
  await t.test("пустой период: пустой список протезов", async (t) => {
    fixtureRows = [];
    t.after(() => { fixtureRows = undefined; });
    const response = await request(`Bearer ${valid}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.prostheses, []);
    assert.equal(response.body.period, null);
    assert.equal(response.body.status, "no_data");
    assert.equal(response.body.data_available_until, null);
  });

  await t.test("доступный период ограничен клиентом из токена", async () => {
    const response = await request(`Bearer ${valid}`, "/reports/availability?customer_id=999");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { data_available_from: "2026-01-01", data_available_until: "2026-01-01" });
    assert.deepEqual(calls.at(-1).query_params, { customer_id: 1 });
    assert.match(calls.at(-1).query, /WHERE\s+customer_id\s*=\s*\{customer_id:\s*UInt32\}/);
  });
  await t.test("нет данных: границы не превращаются в 1970-01-01", async (t) => {
    fixtureRows = [];
    t.after(() => { fixtureRows = undefined; });
    assert.deepEqual((await request(`Bearer ${valid}`, "/reports/availability")).body,
      { data_available_from: null, data_available_until: null });
  });
  await t.test("без дат возвращается только доступный период", async () => {
    const response = await request(`Bearer ${valid}`);
    assert.equal(response.body.status, "ok");
    assert.deepEqual(response.body.period, { from: "2026-01-01", to: "2026-01-01" });
    assert.equal(response.body.period_truncated, false);
    assert.equal(response.body.data_available_until, "2026-01-01");
  });
  await t.test("запрошенный период обрезается с обеих сторон", async (t) => {
    fixtureRows = [martRow(100, "2026-01-04"), martRow(100, "2026-01-13")];
    t.after(() => { fixtureRows = undefined; });
    const response = await request(`Bearer ${valid}`, "/reports?from=2026-01-01&to=2026-01-20");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.period, { from: "2026-01-04", to: "2026-01-13" });
    assert.equal(response.body.period_truncated, true);
    assert.equal(response.body.data_available_until, "2026-01-13");
    assert.deepEqual(calls.at(-1).query_params, { customer_id: 1, from: "2026-01-04", to: "2026-01-13" });
  });
  for (const period of ["from=2026-01-02&to=2026-01-03", "from=2025-01-01&to=2025-01-02", "from=2099-01-01"]) {
    await t.test(`период вне витрины: ${period}`, async () => {
      const count = calls.length;
      const response = await request(`Bearer ${valid}`, `/reports?${period}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "period_unavailable");
      assert.equal(response.body.period, null);
      assert.deepEqual(response.body.prostheses, []);
      assert.equal(calls.length, count + 1, "После проверки границ строки отчёта запрашиваться не должны");
    });
  }
  await t.test("пустой день внутри границ отличается от недоступного периода", async (t) => {
    fixtureRows = [martRow(100, "2026-01-01"), martRow(100, "2026-01-03")];
    t.after(() => { fixtureRows = undefined; });
    const response = await request(`Bearer ${valid}`, "/reports?from=2026-01-02&to=2026-01-02");
    assert.equal(response.body.status, "no_data");
    assert.deepEqual(response.body.prostheses, []);
    assert.deepEqual(response.body.period, { from: "2026-01-02", to: "2026-01-02" });
    assert.equal(response.body.period_truncated, false);
  });
  for (const period of ["from=invalid", "to=2026-02-30", "from=2026-01-03&to=2026-01-01", "from[]=2026-01-01"]) {
    await t.test(`некорректные даты: ${period}`, async () => {
      const count = calls.length;
      const response = await request(`Bearer ${valid}`, `/reports?${period}`);
      assert.equal(response.status, 400);
      assert.equal(calls.length, count);
    });
  }
});
