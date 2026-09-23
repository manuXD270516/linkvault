/** Build-time API origin injected by Vite (`EXTENSION_API_BASE_URL`). */
declare const __EXTENSION_API_BASE_URL__: string;

/**
 * Subconjunto de APIs WebExtension (`chrome` / `browser`) que usa la extensión.
 * Sin `@types/chrome` en el monorepo: tipamos solo lo necesario para MV3.
 * En runtime usar `getBrowser()` (`browser ?? chrome`).
 */
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
      ): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      active?: boolean;
    }
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
  }

  namespace runtime {
    interface MessageSender {
      id?: string;
      tab?: tabs.Tab;
    }
    type MessageResponse = (response?: unknown) => void;
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: MessageResponse,
        ) => boolean | void,
      ): void;
    };
    const lastError: { message?: string } | undefined;
  }

  namespace i18n {
    function getMessage(
      messageName: string,
      substitutions?: string | string[],
    ): string;
    function getUILanguage(): string;
  }
}
