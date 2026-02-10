import type { MenuAction, MenuActionPayloadMap } from '../../shared/menuActionRegistry';
import type { MenuState } from '../../shared/menuStateRegistry';

type Unsubscribe = () => void;

function getAPI() {
  return window.electronAPI;
}

function toUnsubscribe(maybe: void | Unsubscribe): Unsubscribe {
  return typeof maybe === 'function' ? maybe : () => {};
}

export const electronBridge = {
  onMenuAction(handler: <A extends MenuAction>(action: A, payload: MenuActionPayloadMap[A]) => void): Unsubscribe {
    const api = getAPI();
    if (!api?.onMenuAction) return () => {};
    return toUnsubscribe(api.onMenuAction(handler as any));
  },

  onMenuError(handler: (code: string, message: string) => void): Unsubscribe {
    const api = getAPI();
    if (!api?.onMenuError) return () => {};
    return toUnsubscribe(api.onMenuError(handler));
  },

  setMenuState(state: MenuState): void {
    const api = getAPI();
    if (!api?.setMenuState) return;
    try {
      api.setMenuState(state);
    } catch {
      // ignore
    }
  },

  addRecentFile(filePath: string): void {
    const api = getAPI();
    if (!api?.addRecentFile) return;
    try {
      api.addRecentFile(filePath);
    } catch {
      // ignore
    }
  },

  saveFile(content: string, targetPath?: string) {
    const api = getAPI();
    if (!api?.saveFile) return Promise.resolve({ success: false, error: 'electronAPI.saveFile unavailable' });
    return api.saveFile(content, targetPath);
  },

  saveFileDialog(content: string) {
    const api = getAPI();
    if (!api?.saveFileDialog) return Promise.resolve({ success: false, error: 'electronAPI.saveFileDialog unavailable' });
    return api.saveFileDialog(content);
  },

  saveBinaryFile(base64: string, targetPath?: string, filters?: Array<{ name: string; extensions: string[] }>) {
    const api = getAPI();
    if (!api?.saveBinaryFile) return Promise.resolve({ success: false, error: 'electronAPI.saveBinaryFile unavailable' });
    return api.saveBinaryFile(base64, targetPath, filters);
  },

  exportPdfFromHtml(
    html: string,
    options?: { pageSize?: 'A4' | 'Letter'; landscape?: boolean; marginsType?: 0 | 1 | 2; scaleFactor?: number }
  ) {
    const api = getAPI();
    if (!api?.exportPdfFromHtml) return Promise.resolve({ success: false, error: 'electronAPI.exportPdfFromHtml unavailable', canceled: false });
    return api.exportPdfFromHtml(html, options);
  },

  exportPngFromHtml(
    html: string,
    options?: { scaleFactor?: number; tileMaxHeightPx?: number }
  ) {
    const api = getAPI();
    if (!api?.exportPngFromHtml) return Promise.resolve({ success: false, error: 'electronAPI.exportPngFromHtml unavailable', canceled: false });
    return api.exportPngFromHtml(html, options);
  },
} as const;
