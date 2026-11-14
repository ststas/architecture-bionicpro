// Проверка локального стенда с тестовыми пользователями realm-export.json.
// Keycloak должен быть запущен, а витрина — заполнена DAG.
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { config } = require("../dist/config");

const issuer = config.keycloak.issuer;
const oidc = `${issuer}/protocol/openid-connect`;
const api = process.env.REPORTS_API_URL ?? "http://localhost:8000";
const redirectUri = "http://localhost:3000/";

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}

async function login(username, password) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();
  const authorization = new URL(`${oidc}/auth`);
  authorization.search = new URLSearchParams({
    client_id: config.keycloak.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  const page = await request(authorization, { redirect: "manual" });
  assert.equal(page.status, 200, "Keycloak должен показать форму входа");
  const html = await page.text();
  const action = /<form\b[^>]*\baction="([^"]+)"/i.exec(html)?.[1];
  assert.ok(action, "Форма входа Keycloak не найдена");
  const actionUrl = new URL(action.replaceAll("&amp;", "&"));
  assert.equal(actionUrl.origin, authorization.origin);
  const cookie = page.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const result = await request(actionUrl, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  assert.equal(result.status, 302, `Не удалось войти как ${username}`);
  const callback = new URL(result.headers.get("location"));
  assert.equal(callback.origin, new URL(redirectUri).origin);
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code, "Keycloak не вернул authorization code");
  const exchange = await request(`${oidc}/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.keycloak.clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  assert.equal(exchange.status, 200, "Обмен кода с PKCE не удался");
  const tokens = await exchange.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  return tokens;
}

async function reports(token, suffix = "") {
  const response = await request(`${api}/reports${suffix}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

async function availability(token) {
  const response = await request(`${api}/reports/availability?customer_id=999`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  assert.equal((await reports()).status, 401);
  assert.equal((await availability()).status, 401);
  console.log("OK: без токена — 401");
  for (const [username, password, customerId, prostheses] of [
    ["prothetic1", "prothetic123", 1, [101]],
    ["prothetic2", "prothetic123", 2, [102, 103]],
    ["prothetic3", "prothetic123", 3, [104]],
    ["user1", "password123", null, []],
  ]) {
    const tokens = await login(username, password);
    try {
      const response = await reports(tokens.access_token, "?customer_id=999&user_id=999");
      const available = await availability(tokens.access_token);
      if (customerId === null) {
        assert.equal(response.status, 403);
        assert.equal(available.status, 403);
        console.log(`OK: ${username} без роли prothetic_user — 403`);
        continue;
      }
      assert.equal(response.status, 200);
      assert.equal(response.body.customer_id, customerId);
      assert.equal(available.status, 200);
      assert.ok(available.body.data_available_from && available.body.data_available_until);
      assert.equal(response.body.status, "ok");
      assert.equal(response.body.period_truncated, false);
      assert.deepEqual(response.body.period, {
        from: available.body.data_available_from, to: available.body.data_available_until,
      });
      const clipped = await reports(tokens.access_token,
        `?from=${available.body.data_available_from}&to=2099-01-02`);
      assert.equal(clipped.status, 200);
      assert.equal(clipped.body.period.to, available.body.data_available_until);
      assert.equal(clipped.body.period_truncated, true);
      assert.deepEqual(response.body.prostheses.map((group) => group.prosthesis_id).sort(), prostheses);
      assert.equal("rows" in response.body, false);
      for (const group of response.body.prostheses) {
        assert.ok(group.rows.length > 0, "Витрина должна быть заполнена DAG");
        assert.ok(group.prosthesis_model && group.serial_number);
        const dates = group.rows.map(row => row.report_date);
        assert.deepEqual(dates, [...dates].sort());
        assert.ok(group.rows.every(row => !("prosthesis_id" in row) && !("serial_number" in row)));
      }
      const empty = await reports(tokens.access_token, "?from=2099-01-01&to=2099-01-02");
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body.prostheses, []);
      assert.equal(empty.body.period, null);
      assert.equal(empty.body.status, "period_unavailable");
      const parts = tokens.access_token.split(".");
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      parts[1] = Buffer.from(JSON.stringify({ ...claims, customer_id: 999 })).toString("base64url");
      assert.equal((await reports(parts.join("."))).status, 401);
      assert.equal((await reports(tokens.id_token)).status, 401);
      assert.equal((await reports(tokens.refresh_token)).status, 401);
      console.log(`OK: ${username} — своих групп: ${prostheses.length}; доступные даты, обрезка и недоступный период; недопустимые токены — 401`);
    } finally {
      const logout = await request(`${oidc}/logout`, {
        method: "POST",
        body: new URLSearchParams({
          client_id: config.keycloak.clientId,
          refresh_token: tokens.refresh_token,
        }),
      });
      assert.equal(logout.status, 204, "Не удалось закрыть тестовую сессию");
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
