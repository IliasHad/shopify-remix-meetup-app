import crypto from "crypto";

import jwt from "jsonwebtoken";
import {
  LATEST_API_VERSION,
  JwtPayload,
  LogSeverity,
  Session,
} from "@shopify/shopify-api";
import { SessionStorage } from "@shopify/shopify-app-session-storage";
import { MemorySessionStorage } from "@shopify/shopify-app-session-storage-memory";

import { AppConfigArg } from "../config-types";

// eslint-disable-next-line import/no-mutable-exports
export function testConfig(
  overrides: Partial<AppConfigArg> = {}
): AppConfigArg & { sessionStorage: SessionStorage } {
  return {
    apiKey: "testApiKey",
    apiSecretKey: "testApiSecretKey",
    scopes: ["testScope"],
    apiVersion: LATEST_API_VERSION,
    appUrl: "https://my-test-app.myshopify.io",
    logger: {
      log: jest.fn(),
      level: LogSeverity.Debug,
    },
    isEmbeddedApp: true,
    sessionStorage: new MemorySessionStorage(),
    ...overrides,
  };
}

export const SHOPIFY_HOST = "totally-real-host.myshopify.io";
export const BASE64_HOST = Buffer.from(SHOPIFY_HOST).toString("base64");
export const TEST_SHOP = "test-shop.myshopify.io";
export const GRAPHQL_URL = `https://${TEST_SHOP}/admin/api/${LATEST_API_VERSION}/graphql.json`;
const USER_ID = 12345;

interface TestJwt {
  token: string;
  payload: JwtPayload;
}

export function getJwt(
  apiKey: string,
  apiSecretKey: string,
  overrides: Partial<JwtPayload> = {}
): TestJwt {
  const date = new Date();
  const payload = {
    iss: `${TEST_SHOP}/admin`,
    dest: `https://${TEST_SHOP}`,
    aud: apiKey,
    sub: `${USER_ID}`,
    exp: date.getTime() / 1000 + 3600,
    nbf: date.getTime() / 1000 - 3600,
    iat: date.getTime() / 1000 - 3600,
    jti: "1234567890",
    sid: "0987654321",
    ...overrides,
  };

  const token = jwt.sign(payload, apiSecretKey, {
    algorithm: "HS256",
  });

  return { token, payload };
}

export async function getThrownResponse(
  callback: Function,
  request: Request
): Promise<Response> {
  try {
    await callback(request);
  } catch (response) {
    if (!(response instanceof Response)) {
      throw `${request.method} request to ${request.url} threw an error instead of a response: ${response}`;
    }
    return response;
  }

  throw `${request.method} request to ${request.url} did not throw`;
}

export function createTestHmac(secretKey: string, body: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(body, "utf8")
    .digest("base64");
}

export async function setUpValidSession(
  sessionStorage: SessionStorage,
  isOnline: boolean = false
): Promise<Session> {
  const overrides: Partial<Session> = {};
  let id = `offline_${TEST_SHOP}`;
  if (isOnline) {
    id = `${TEST_SHOP}_${USER_ID}`;
    // Expires one day from now
    overrides.expires = new Date(Date.now() + 1000 * 3600 * 24);
    overrides.onlineAccessInfo = {
      associated_user_scope: "testScope",
      expires_in: 3600 * 24,
      associated_user: {
        id: USER_ID,
        account_owner: true,
        collaborator: true,
        email: "test@test.test",
        email_verified: true,
        first_name: "Test",
        last_name: "User",
        locale: "en-US",
      },
    };
  }

  const session = new Session({
    id,
    shop: TEST_SHOP,
    isOnline,
    state: "test",
    accessToken: "totally_real_token",
    scope: "testScope",
    ...overrides,
  });
  await sessionStorage.storeSession(session);

  return session;
}

export function signRequestCookie({
  request,
  cookieName,
  cookieValue,
  apiSecretKey,
}: {
  request: Request;
  cookieName: string;
  cookieValue: string;
  apiSecretKey: string;
}) {
  const signedCookieValue = createTestHmac(apiSecretKey, cookieValue);

  request.headers.set(
    "Cookie",
    [
      `${cookieName}=${cookieValue}`,
      `${cookieName}.sig=${signedCookieValue}`,
    ].join(";")
  );
}
