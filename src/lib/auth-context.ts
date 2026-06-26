import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthContext {
  userId?: string;
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
