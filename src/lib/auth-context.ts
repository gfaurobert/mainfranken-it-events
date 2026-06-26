import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestLog {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface AuthContext {
  userId?: string;
  log?: RequestLog;
}

export const authContext = new AsyncLocalStorage<AuthContext>();

export function getAuthUserId(): string | undefined {
  return authContext.getStore()?.userId;
}

export function requireAuthUserId(): string {
  const userId = getAuthUserId();
  if (!userId) {
    throw new Error("Authentication required. Call register_user and configure your PAT.");
  }
  return userId;
}

export function getRequestLog(): RequestLog | undefined {
  return authContext.getStore()?.log;
}
