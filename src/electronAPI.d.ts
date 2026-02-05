import type { MenuAction, MenuActionPayloadMap } from '../shared/menuActionRegistry';
import type { MenuState } from '../shared/menuStateRegistry';

declare global {
  interface Window {
    electronAPI?: {
      onMenuAction: (
        handler: <A extends MenuAction>(action: A, payload: MenuActionPayloadMap[A]) => void
      ) => (() => void) | void;
      onMenuError: (handler: (code: string, message: string) => void) => (() => void) | void;

      saveFile: (content: string, targetPath?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      saveFileDialog: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;

      saveBinaryFile: (
        base64: string,
        targetPath?: string,
        filters?: Array<{ name: string; extensions: string[] }>
      ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      // Fire-and-forget: renderer notifies main to update the Recents menu.
      addRecentFile: (filePath: string) => void;

      // Renderer -> main: keep native menu checkmarks in sync
      setMenuState: (state: MenuState) => void;

      guitarLibrary?: {
        load: () => Promise<any>;
        save: (library: any) => Promise<any>;
      };
    };
  }
}

export {};
