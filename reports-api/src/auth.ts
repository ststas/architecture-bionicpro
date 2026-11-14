import { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config";

/** Данные пользователя, взятые из проверенного токена. */
export interface AuthUser {
  customerId: number;
  username: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

// Публичные ключи Keycloak; jose сам кеширует их и перечитывает при смене ключа.
const jwks = createRemoteJWKSet(new URL(config.keycloak.jwksUrl));

/**
 * Проверяет access-токен Keycloak и кладёт пользователя в req.user.
 * 401 — токена нет или он недействителен; 403 — токен верный, но прав на отчёт нет.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) {
    res.status(401).json({ error: "unauthorized", message: "Требуется access-токен" });
    return;
  }

  let payload;
  try {
    // Принимаем только подписанные RS256 токены с обязательным сроком действия.
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: config.keycloak.issuer,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"],
    }));
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Токен недействителен или просрочен" });
    return;
  }

  // В Keycloak claim typ отличает access-токен от ID- и refresh-токенов.
  if (payload.typ !== "Bearer" || typeof payload.sub !== "string" || !payload.sub) {
    res.status(401).json({ error: "unauthorized", message: "Требуется access-токен пользователя" });
    return;
  }

  // Токен должен быть выдан нашему клиенту, а не другому приложению того же realm.
  if (payload.azp !== config.keycloak.clientId) {
    res.status(401).json({ error: "unauthorized", message: "Токен выдан другому клиенту" });
    return;
  }

  const realmAccess = payload.realm_access;
  const roles =
    typeof realmAccess === "object" && realmAccess !== null && "roles" in realmAccess
      ? realmAccess.roles
      : undefined;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string") ||
      !roles.includes(config.keycloak.requiredRole)) {
    res.status(403).json({ error: "forbidden", message: "Отчёты доступны только пользователям протезов" });
    return;
  }

  // Чей отчёт отдавать, определяет только подписанный claim customer_id.
  const customerId = payload.customer_id;
  // customer_id в витрине имеет тип UInt32.
  if (typeof customerId !== "number" || !Number.isInteger(customerId) ||
      customerId <= 0 || customerId > 0xffffffff) {
    res.status(403).json({ error: "forbidden", message: "Учётная запись не связана с клиентом" });
    return;
  }

  req.user = { customerId, username: String(payload.preferred_username ?? "") };
  next();
}
