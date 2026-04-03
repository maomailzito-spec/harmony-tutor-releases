import type { MenuAction, MenuActionPayloadMap } from '../shared/menuActionRegistry';
import type { MenuState } from '../shared/menuStateRegistry';

declare global {
  interface Window {
    electronAPI?: {
      onMenuAction: (
        handler: <A extends MenuAction>(action: A, payload: MenuActionPayloadMap[A]) => void
      ) => (() => void) | void;
      onMenuError: (handler: (code: string, message: string) => void) => (() => void) | void;

      saveFile: (content: string, targetPath?: string) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;
      saveFileDialog: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;

      saveBinaryFile: (
        base64: string,
        targetPath?: string,
        filters?: Array<{ name: string; extensions: string[] }>
      ) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;

      exportPdfFromHtml: (
        html: string,
        options?: {
          pageSize?: 'A4' | 'Letter';
          landscape?: boolean;
          marginsType?: 0 | 1 | 2;
          // Electron printToPDF scale factor as a percentage (default 100).
          scaleFactor?: number;
        }
      ) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;

      exportPngFromHtml: (
        html: string,
        options?: {
          // Browser zoom factor (1 = 100%).
          scaleFactor?: number;
          tileMaxHeightPx?: number;
        }
      ) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean; files?: string[] }>;
      exportMusicXml: (
        xml: string
      ) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;
      // Fire-and-forget: renderer notifies main to update the Recents menu.
      addRecentFile: (filePath: string) => void;

      // Renderer -> main: keep native menu checkmarks in sync
      setMenuState: (state: MenuState) => void;

      guitarLibrary?: {
        load: () => Promise<any>;
        save: (library: any) => Promise<any>;
      };
      trial?: {
        getInfo: () => Promise<{
          installed: boolean;
          installDate?: string;
          daysElapsed?: number;
          daysRemaining?: number;
          expired?: boolean;
        }>;
      };
    };
  }
}

export {};
