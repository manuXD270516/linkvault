import { ExtensionApi, ApiHttpError } from '../lib/api';
import { getBrowser } from '../lib/browser-api';
import type { ExtensionMessage, ExtensionMessageResult } from '../lib/messaging';
import { readSession } from '../lib/storage';

/** Única instancia de refresh: el SW es el dueño del mutex single-flight. */
const api = new ExtensionApi();

getBrowser().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error: unknown) => sendResponse(toFailure(error)));
  return true;
});

async function handleMessage(raw: unknown): Promise<ExtensionMessageResult> {
  const message = raw as ExtensionMessage;
  switch (message.type) {
    case 'GET_SESSION': {
      const session = await readSession();
      return { ok: true, data: session };
    }
    case 'LOGIN': {
      const session = await api.login(message.email, message.password);
      return { ok: true, data: session };
    }
    case 'LOGOUT': {
      await api.logout();
      return { ok: true };
    }
    case 'REFRESH': {
      const session = await api.refresh();
      return { ok: true, data: session };
    }
    case 'LIST_GROUPS': {
      const groups = await api.listGroups();
      return { ok: true, data: groups };
    }
    case 'SAVE_LINK': {
      const saved = await api.saveLink(message.url, message.groupId);
      return { ok: true, data: saved };
    }
    default:
      return {
        ok: false,
        error: { message: 'Unknown message' },
      };
  }
}

function toFailure(error: unknown): ExtensionMessageResult {
  if (error instanceof ApiHttpError) {
    return {
      ok: false,
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
      },
    };
  }
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : 'Unknown error',
    },
  };
}
