// src/controllers/MenuEditController.ts
export type MenuAction = 'copy' | 'paste' | 'cut' | 'selectAll';

export type MenuEditCallbacks = {
  onCopy?: () => void;
  onPaste?: () => void;
  onCut?: () => void;
  onSelectAll?: () => void;
};

class MenuEditController {
  private callbacks: Partial<MenuEditCallbacks> = {};

  registerCallbacks(callbacks: Partial<MenuEditCallbacks>) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  handleMenuAction(action: MenuAction) {
    switch (action) {
      case 'copy':
        this.callbacks.onCopy?.();
        break;
      case 'paste':
        this.callbacks.onPaste?.();
        break;
      case 'cut':
        this.callbacks.onCut?.();
        break;
      case 'selectAll':
        this.callbacks.onSelectAll?.();
        break;
      default:
        // log: azione non gestita
        break;
    }
  }
}

export const menuEditController = new MenuEditController();
