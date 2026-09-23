import { getBrowser } from './browser-api';
import type { ExtensionMessage, ExtensionMessageResult } from './messaging';
import type { ExtensionSession } from './storage';
import type { GroupListItem, SaveLinkApiResponse } from './api';

export async function sendExtensionMessage(
  message: ExtensionMessage,
): Promise<ExtensionMessageResult> {
  return (await getBrowser().runtime.sendMessage(
    message,
  )) as ExtensionMessageResult;
}

export async function getSession(): Promise<ExtensionSession | null> {
  const result = await sendExtensionMessage({ type: 'GET_SESSION' });
  if (!result.ok) {
    return null;
  }
  return (result.data as ExtensionSession | null) ?? null;
}

export async function login(
  email: string,
  password: string,
): Promise<ExtensionMessageResult> {
  return sendExtensionMessage({ type: 'LOGIN', email, password });
}

export async function logout(): Promise<ExtensionMessageResult> {
  return sendExtensionMessage({ type: 'LOGOUT' });
}

export async function listGroups(): Promise<GroupListItem[]> {
  const result = await sendExtensionMessage({ type: 'LIST_GROUPS' });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return (result.data as GroupListItem[]) ?? [];
}

export async function saveLink(
  url: string,
  groupId?: string | null,
): Promise<SaveLinkApiResponse> {
  const result = await sendExtensionMessage({ type: 'SAVE_LINK', url, groupId });
  if (!result.ok) {
    const err = new Error(result.error.message) as Error & {
      status?: number;
      code?: string;
    };
    err.status = result.error.status;
    err.code = result.error.code;
    throw err;
  }
  return result.data as SaveLinkApiResponse;
}
