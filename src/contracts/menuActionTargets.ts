import { MENU_ACTIONS } from './menuActionRuntime';
import type { MenuAction } from '../../shared/menuActionRegistry';

export type MenuActionTarget = 'app' | 'grandStaff';

export const MENU_ACTION_TARGET: Record<MenuAction, MenuActionTarget> = {
  [MENU_ACTIONS.NEW]: 'grandStaff',
  [MENU_ACTIONS.OPEN]: 'grandStaff',
  [MENU_ACTIONS.IMPORT_MIDI]: 'grandStaff',
  [MENU_ACTIONS.IMPORT_MUSICXML]: 'grandStaff',
  [MENU_ACTIONS.EXPORT_MIDI]: 'grandStaff',
  [MENU_ACTIONS.EXPORT_MUSICXML]: 'grandStaff',
  [MENU_ACTIONS.EXPORT_PDF]: 'grandStaff',
  [MENU_ACTIONS.EXPORT_PNG]: 'grandStaff',
  [MENU_ACTIONS.PRINT]: 'grandStaff',
  [MENU_ACTIONS.SAVE]: 'grandStaff',
  [MENU_ACTIONS.SAVE_AS]: 'grandStaff',
  [MENU_ACTIONS.CLOSE_PROJECT]: 'grandStaff',

  [MENU_ACTIONS.UNDO]: 'grandStaff',
  [MENU_ACTIONS.REDO]: 'grandStaff',
  [MENU_ACTIONS.EDIT_COMMAND]: 'grandStaff',

  [MENU_ACTIONS.OPEN_PREFERENCES]: 'grandStaff',
  [MENU_ACTIONS.TOGGLE_TOOLBAR_CUSTOMIZE]: 'grandStaff',

  [MENU_ACTIONS.SET_QUICK_INSERT_BAR]: 'grandStaff',
  [MENU_ACTIONS.SET_TOOLBAR_HIDDEN]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_MEASURE_NUMBERS]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_HARMONY_DEBUG]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_VOICE_COLORS]: 'grandStaff',
  [MENU_ACTIONS.SET_CONCERT_PITCH]: 'grandStaff',
  [MENU_ACTIONS.SET_ENGRAVING_MODE]: 'grandStaff',
  [MENU_ACTIONS.RUN_OVERLAP_AUDIT]: 'grandStaff',

  [MENU_ACTIONS.SET_TITLE_FONT_FAMILY]: 'grandStaff',
  [MENU_ACTIONS.INCREASE_TITLE_FONT]: 'grandStaff',
  [MENU_ACTIONS.DECREASE_TITLE_FONT]: 'grandStaff',

  [MENU_ACTIONS.SET_SELECT_ONLY_VOICE]: 'grandStaff',

  // Chorale generation panel
  [MENU_ACTIONS.GENERATE_FROM_ROMAN]: 'grandStaff',

  // Analysis lock (teacher mode)
  [MENU_ACTIONS.TOGGLE_ANALYSIS_LOCK]: 'grandStaff',

  // App-level routing (view switching)
  [MENU_ACTIONS.SET_ANALYSIS_SUBJECT]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_ROMAN]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_SYMBOLS]: 'grandStaff',
  [MENU_ACTIONS.SET_SHOW_FIGURED_BASS]: 'grandStaff',
  [MENU_ACTIONS.SET_SATB_VISIBLE]: 'grandStaff',
  [MENU_ACTIONS.SET_TRACK_VISIBLE]: 'grandStaff',
  [MENU_ACTIONS.TOGGLE_VIOLATIONS_PANEL]: 'grandStaff',
  [MENU_ACTIONS.SET_APP_MODE]: 'app',
};

export function getMenuActionTarget(action: MenuAction): MenuActionTarget {
  return MENU_ACTION_TARGET[action] ?? 'grandStaff';
}
