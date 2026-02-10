import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

type AuditFailure = {
  title: string;
  details: string[];
};

function repoPath(...parts: string[]) {
  return path.resolve(process.cwd(), ...parts);
}

function readText(filePath: string) {
  return fs.readFileSync(filePath, 'utf-8');
}

function uniqueSorted(items: Iterable<string>) {
  return Array.from(new Set(items)).sort();
}

function setDiff(a: Set<string>, b: Set<string>) {
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

function failIf(cond: boolean, failure: AuditFailure, failures: AuditFailure[]) {
  if (cond) failures.push(failure);
}

function isIdentStart(ch: string) {
  return /[A-Za-z_$]/.test(ch);
}
function isIdentPart(ch: string) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function skipWhitespaceAndComments(src: string, i: number) {
  while (i < src.length) {
    const ch = src[i];
    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // line comment
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // block comment
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    return i;
  }
  return i;
}

function readStringLiteral(src: string, i: number) {
  const quote = src[i];
  let out = '';
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      // skip escaped char
      i += 2;
      continue;
    }
    if (ch === quote) {
      i++;
      break;
    }
    out += ch;
    i++;
  }
  return { value: out, next: i };
}

function skipTemplateLiteral(src: string, i: number) {
  // assumes src[i] == '`'
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      i++;
      break;
    }
    // template interpolation
    if (ch === '$' && src[i + 1] === '{') {
      i += 2;
      i = skipBalanced(src, i, '}');
      continue;
    }
    i++;
  }
  return i;
}

function skipBalanced(src: string, i: number, untilClose: string) {
  // skip JS/TS expression until we hit a matching close token at depth 0.
  // This is used after consuming `${` and wants to stop at the matching `}`.
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;

  while (i < src.length) {
    i = skipWhitespaceAndComments(src, i);
    if (i >= src.length) break;

    const ch = src[i];
    if (ch === '\'' || ch === '"') {
      i = readStringLiteral(src, i).next;
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(src, i);
      continue;
    }

    if (ch === '{') depthBrace++;
    else if (ch === '}') {
      if (depthBrace === 0 && depthParen === 0 && depthBracket === 0 && untilClose === '}') {
        return i + 1;
      }
      depthBrace = Math.max(0, depthBrace - 1);
    }
    else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);

    i++;
  }

  return i;
}

function skipExpressionUntilCommaOrClose(src: string, i: number) {
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let inGenericAngle = 0;

  while (i < src.length) {
    i = skipWhitespaceAndComments(src, i);
    if (i >= src.length) return { next: i, endedBy: 'eof' as const };

    const ch = src[i];

    if (ch === '\'' || ch === '"') {
      i = readStringLiteral(src, i).next;
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(src, i);
      continue;
    }

    // Track TS generics (best-effort): Promise<...>, Array<...>
    if (ch === '<') inGenericAngle++;
    else if (ch === '>' && inGenericAngle > 0) inGenericAngle--;

    if (ch === '{') depthBrace++;
    else if (ch === '}') {
      if (depthBrace === 0 && depthParen === 0 && depthBracket === 0 && inGenericAngle === 0) {
        return { next: i, endedBy: 'close' as const };
      }
      depthBrace = Math.max(0, depthBrace - 1);
    }
    else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if ((ch === ',' || ch === ';') && depthBrace === 0 && depthParen === 0 && depthBracket === 0 && inGenericAngle === 0) {
      return { next: i + 1, endedBy: 'comma' as const };
    }

    i++;
  }

  return { next: i, endedBy: 'eof' as const };
}

function parseObjectKeysFlat(src: string, startAtBrace: number, prefix: string) {
  const keys: string[] = [];

  let i = startAtBrace;
  if (src[i] !== '{') return keys;
  i++; // after '{'

  while (i < src.length) {
    i = skipWhitespaceAndComments(src, i);
    if (i >= src.length) break;

    if (src[i] === '}') {
      i++;
      break;
    }

    // Read key
    let key: string | null = null;
    const ch = src[i];
    if (ch === '\'' || ch === '"') {
      const r = readStringLiteral(src, i);
      key = r.value;
      i = r.next;
    } else if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j])) j++;
      key = src.slice(i, j);
      i = j;
    } else {
      // Unsupported key (computed, spread, etc) -> skip token until comma/close
      const r = skipExpressionUntilCommaOrClose(src, i);
      i = r.next;
      continue;
    }

    i = skipWhitespaceAndComments(src, i);
    // TS optional property marker: `foo?: ...`
    if (src[i] === '?') {
      i++;
      i = skipWhitespaceAndComments(src, i);
    }

    if (src[i] !== ':') {
      // Not a property; skip until next comma/close
      const r = skipExpressionUntilCommaOrClose(src, i);
      i = r.next;
      continue;
    }
    i++; // after ':'

    const fullKey = prefix ? `${prefix}.${key}` : key;

    i = skipWhitespaceAndComments(src, i);

    // If value is an object literal, recurse; otherwise just record the key.
    if (src[i] === '{') {
      keys.push(fullKey);
      keys.push(...parseObjectKeysFlat(src, i, fullKey));

      // Advance past the nested object
      // Find matching '}' for this object using a small stack.
      let depth = 0;
      while (i < src.length) {
        const c = src[i];
        if (c === '\'' || c === '"') {
          i = readStringLiteral(src, i).next;
          continue;
        }
        if (c === '`') {
          i = skipTemplateLiteral(src, i);
          continue;
        }
        if (c === '/' && src[i + 1] === '/') {
          i += 2;
          while (i < src.length && src[i] !== '\n') i++;
          continue;
        }
        if (c === '/' && src[i + 1] === '*') {
          i += 2;
          while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
          i += 2;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          i++;
          if (depth === 0) break;
          continue;
        }
        i++;
      }

      i = skipWhitespaceAndComments(src, i);
      if (src[i] === ',' || src[i] === ';') i++;
      continue;
    }

    keys.push(fullKey);

    // Skip value expression
    const r = skipExpressionUntilCommaOrClose(src, i);
    i = r.next;

    // TS type literals use ';' separators; JS objects use ','.
    i = skipWhitespaceAndComments(src, i);
    if (src[i] === ',' || src[i] === ';') i++;

    // If ended by close, do not consume it here; loop will handle.
  }

  return keys;
}

function findFirstObjectAfterAnchor(src: string, anchor: string) {
  const anchorIndex = src.indexOf(anchor);
  if (anchorIndex < 0) return null;

  let i = anchorIndex + anchor.length;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return null;
  return i;
}

function extractElectronApiFromPreload(preloadPath: string) {
  const src = readText(preloadPath);

  // Support both single/double quotes around electronAPI
  const anchors = [
    "contextBridge.exposeInMainWorld('electronAPI'",
    'contextBridge.exposeInMainWorld("electronAPI"',
  ];

  let braceIndex: number | null = null;
  for (const a of anchors) {
    const idx = findFirstObjectAfterAnchor(src, a);
    if (idx != null) {
      braceIndex = idx;
      break;
    }
  }

  if (braceIndex == null) return { keys: new Set<string>(), raw: src };

  const flat = parseObjectKeysFlat(src, braceIndex, '');
  return { keys: new Set(flat), raw: src };
}

function extractElectronApiFromDts(dtsPath: string) {
  const src = readText(dtsPath);

  const anchor = 'electronAPI?:';
  const braceIndex = findFirstObjectAfterAnchor(src, anchor);
  if (braceIndex == null) return { keys: new Set<string>(), raw: src };

  const flat = parseObjectKeysFlat(src, braceIndex, '');
  return { keys: new Set(flat), raw: src };
}

function extractIPCKeyUsages(src: string) {
  const keys = new Set<string>();
  const re = /IPC_CHANNELS\.([A-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) keys.add(m[1]);
  return keys;
}

function extractIpcMainHandledKeys(mainSrc: string) {
  const keys = new Set<string>();
  const re = /ipcMain\.(?:handle|on)\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainSrc))) keys.add(m[1]);
  return keys;
}

function extractIpcRendererUsedKeys(preloadSrc: string) {
  const keys = new Set<string>();
  const re = /ipcRenderer\.(?:invoke|send|on)\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(preloadSrc))) keys.add(m[1]);
  return keys;
}

function extractMenuActionsFromSharedJS(sharedRegistryPath: string) {
  const req = createRequire(import.meta.url);
  const mod = req(sharedRegistryPath);
  const menu = (mod && mod.MENU_ACTIONS) ? mod.MENU_ACTIONS : {};
  const values = Object.values(menu).filter(v => typeof v === 'string') as string[];
  return new Set(values);
}

function extractMenuActionKeysFromSharedJS(sharedRegistryPath: string) {
  const req = createRequire(import.meta.url);
  const mod = req(sharedRegistryPath);
  const menu = (mod && mod.MENU_ACTIONS) ? mod.MENU_ACTIONS : {};
  const keys = Object.keys(menu).filter(k => typeof (menu as any)[k] === 'string');
  return new Set(keys);
}

function extractMenuActionKeysUsedInMain(mainSrc: string) {
  const keys = new Set<string>();
  const re = /MENU_ACTIONS\.([A-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainSrc))) keys.add(m[1]);
  return keys;
}

function extractSendActionStringLiterals(mainSrc: string) {
  const actions = new Set<string>();
  // sendAction('print') / sendAction("open") / sendAction(`export-midi`)
  const re = /sendAction\(\s*(['"`])([^'"`]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainSrc))) actions.add(m[2]);
  return actions;
}

function listSourceFilesRecursive(dirPath: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listSourceFilesRecursive(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function scanRendererForForbiddenNodeImports(srcDir: string) {
  const offenders: string[] = [];
  const files = listSourceFilesRecursive(srcDir);

  // Renderer hard rule: never import/require fs/path in app sources.
  const forbidden = [
    /\bfrom\s+['"](?:node:)?fs['"]/g,
    /\bfrom\s+['"](?:node:)?path['"]/g,
    /\brequire\(\s*['"](?:node:)?fs['"]\s*\)/g,
    /\brequire\(\s*['"](?:node:)?path['"]\s*\)/g,
  ];

  for (const fp of files) {
    if (!fp.endsWith('.ts') && !fp.endsWith('.tsx')) continue;
    if (fp.endsWith('.d.ts')) continue;
    const src = readText(fp);
    if (forbidden.some((re) => re.test(src))) offenders.push(path.relative(process.cwd(), fp));
  }

  return offenders.sort();
}

function extractHandledMenuActionsFromHandlerSources(
  handlerSources: string[],
  menuActionsByKey: Record<string, string>
) {
  const handled = new Set<string>();

  const reEqLiteral = /\baction\s*===\s*(['"])([^'"]+)\1/g;
  const reCaseLiteral = /\bcase\s+(['"])([^'"]+)\1\s*:/g;
  const reEqConst = /\baction\s*===\s*MENU_ACTIONS\.([A-Z0-9_]+)/g;
  const reNeConst = /\baction\s*!==\s*MENU_ACTIONS\.([A-Z0-9_]+)/g;
  const reCaseConst = /\bcase\s+MENU_ACTIONS\.([A-Z0-9_]+)\s*:/g;

  for (const block of handlerSources) {
    let m: RegExpExecArray | null;
    while ((m = reEqLiteral.exec(block))) handled.add(m[2]);
    while ((m = reCaseLiteral.exec(block))) handled.add(m[2]);

    const addKey = (key: string) => {
      const v = (menuActionsByKey as any)[key];
      if (typeof v === 'string') handled.add(v);
    };

    while ((m = reEqConst.exec(block))) addKey(m[1]);
    while ((m = reNeConst.exec(block))) addKey(m[1]);
    while ((m = reCaseConst.exec(block))) addKey(m[1]);
  }

  return handled;
}

function extractBraceBlockAt(src: string, openBraceIndex: number) {
  if (src[openBraceIndex] !== '{') return null;
  let i = openBraceIndex;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\'' || c === '"') {
      i = readStringLiteral(src, i).next;
      continue;
    }
    if (c === '`') {
      i = skipTemplateLiteral(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      i++;
      if (depth === 0) return { block: src.slice(openBraceIndex, i), end: i };
      continue;
    }
    i++;
  }

  return null;
}

function extractBlocksFromOnMenuActionCallbacks(src: string) {
  const blocks: string[] = [];
  let from = 0;

  while (from < src.length) {
    const idx = src.indexOf('onMenuAction', from);
    if (idx < 0) break;
    const arrowIdx = src.indexOf('=>', idx);
    if (arrowIdx < 0) {
      from = idx + 10;
      continue;
    }

    let i = arrowIdx + 2;
    i = skipWhitespaceAndComments(src, i);
    if (src[i] !== '{') {
      from = arrowIdx + 2;
      continue;
    }

    const r = extractBraceBlockAt(src, i);
    if (r) {
      blocks.push(r.block);
      from = r.end;
    } else {
      from = i + 1;
    }
  }

  return blocks;
}

function extractBlocksFromMenuActionTypedHandlers(src: string) {
  const blocks: string[] = [];
  const re = /\baction\s*:\s*MenuAction\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src))) {
    let i = m.index;
    // Find the next opening brace for the function body.
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) continue;
    const r = extractBraceBlockAt(src, i);
    if (r) {
      blocks.push(r.block);
      re.lastIndex = r.end;
    }
  }

  return blocks;
}

function extractMenuActionsFromDts(dtsPath: string) {
  const src = readText(dtsPath);

  // Extract keys of MenuActionPayloadMap:  'open': ..., "open": ...
  const start = src.indexOf('export type MenuActionPayloadMap');
  if (start < 0) return new Set<string>();

  const slice = src.slice(start);
  const re = /\n\s*['"]([^'"]+)['"]\s*:\s*/g;

  const actions = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) {
    actions.add(m[1]);
  }

  return actions;
}

function extractIpcChannelsFromSharedJS(sharedIpcPath: string) {
  const req = createRequire(import.meta.url);
  const mod = req(sharedIpcPath);
  const channels = (mod && mod.IPC_CHANNELS) ? mod.IPC_CHANNELS : {};
  const keys = Object.keys(channels).filter(k => typeof (channels as any)[k] === 'string');
  return new Set(keys);
}

function extractIpcChannelsFromDts(dtsPath: string) {
  const src = readText(dtsPath);
  const start = src.indexOf('export const IPC_CHANNELS');
  if (start < 0) return new Set<string>();
  const slice = src.slice(start);

  const re = /\n\s*([A-Z0-9_]+)\s*:\s*['"][^'"]+['"]/g;
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) keys.add(m[1]);
  return keys;
}

function main() {
  const failures: AuditFailure[] = [];

  const paths = {
    ipcJs: repoPath('shared/ipcChannels.js'),
    ipcDts: repoPath('shared/ipcChannels.d.ts'),
    preload: repoPath('electron/preload.js'),
    main: repoPath('electron/main.js'),
    electronApiDts: repoPath('src/electronAPI.d.ts'),
    menuJs: repoPath('shared/menuActionRegistry.js'),
    menuDts: repoPath('shared/menuActionRegistry.d.ts'),
  };

  // --- IPC registry vs typings
  const ipcKeysJs = extractIpcChannelsFromSharedJS(paths.ipcJs);
  const ipcKeysDts = extractIpcChannelsFromDts(paths.ipcDts);
  {
    const { onlyA, onlyB } = setDiff(ipcKeysJs, ipcKeysDts);
    failIf(onlyA.length > 0 || onlyB.length > 0, {
      title: 'IPC_CHANNELS mismatch: shared/ipcChannels.js vs shared/ipcChannels.d.ts',
      details: [
        ...(onlyA.length ? [`Only in JS: ${onlyA.join(', ')}`] : []),
        ...(onlyB.length ? [`Only in DTS: ${onlyB.join(', ')}`] : []),
      ],
    }, failures);
  }

  // --- IPC usages in preload/main must reference only known keys
  const preloadSrc = readText(paths.preload);
  const mainSrc = readText(paths.main);

  const preloadIpcUsed = extractIpcRendererUsedKeys(preloadSrc);
  const mainIpcHandled = extractIpcMainHandledKeys(mainSrc);

  const sharedMenuRegistryMod = createRequire(import.meta.url)(paths.menuJs);
  const sharedMenuActionsByKey = (sharedMenuRegistryMod && sharedMenuRegistryMod.MENU_ACTIONS) ? sharedMenuRegistryMod.MENU_ACTIONS : {};
  const usedMenuActionKeysInMain = extractMenuActionKeysUsedInMain(mainSrc);

  {
    const unknownInPreload = uniqueSorted(Array.from(preloadIpcUsed).filter(k => !ipcKeysJs.has(k)));
    const unknownInMain = uniqueSorted(Array.from(mainIpcHandled).filter(k => !ipcKeysJs.has(k)));

    failIf(unknownInPreload.length > 0, {
      title: 'Unknown IPC_CHANNELS keys used in electron/preload.js',
      details: unknownInPreload,
    }, failures);

    failIf(unknownInMain.length > 0, {
      title: 'Unknown IPC_CHANNELS keys used in electron/main.js',
      details: unknownInMain,
    }, failures);
  }

  // Optional strictness: every invoke/send exposed in preload should be handled in main.
  // (Allows MENU_ACTION/MENU_ERROR which are event-bus, not ipcMain.handle.)
  {
    const allowedUnHandled = new Set(['MENU_ACTION', 'MENU_ERROR', 'ADD_RECENT', 'SET_MENU_STATE']);
    const missingHandlers = uniqueSorted(
      Array.from(preloadIpcUsed).filter(k => !allowedUnHandled.has(k) && !mainIpcHandled.has(k))
    );

    failIf(missingHandlers.length > 0, {
      title: 'IPC keys used by preload but not handled by main',
      details: missingHandlers.map(k => `IPC_CHANNELS.${k}`),
    }, failures);
  }

  // --- Electron API surface: preload vs electronAPI.d.ts
  const preloadApi = extractElectronApiFromPreload(paths.preload);
  const dtsApi = extractElectronApiFromDts(paths.electronApiDts);

  {
    const { onlyA, onlyB } = setDiff(preloadApi.keys, dtsApi.keys);

    // A: preload only (runtime exposed but untyped)
    failIf(onlyA.length > 0, {
      title: 'electronAPI mismatch: exposed in preload but missing in src/electronAPI.d.ts',
      details: onlyA,
    }, failures);

    // B: d.ts only (typed but not exposed at runtime)
    failIf(onlyB.length > 0, {
      title: 'electronAPI mismatch: declared in src/electronAPI.d.ts but not exposed in preload',
      details: onlyB,
    }, failures);
  }

  // --- Menu actions: shared JS registry vs d.ts payload map keys
  const menuActionsJs = extractMenuActionsFromSharedJS(paths.menuJs);
  const menuActionKeysJs = extractMenuActionKeysFromSharedJS(paths.menuJs);
  const menuActionsDts = extractMenuActionsFromDts(paths.menuDts);
  {
    const { onlyA, onlyB } = setDiff(menuActionsJs, menuActionsDts);
    failIf(onlyA.length > 0 || onlyB.length > 0, {
      title: 'MENU_ACTIONS mismatch: shared/menuActionRegistry.js vs shared/menuActionRegistry.d.ts MenuActionPayloadMap',
      details: [
        ...(onlyA.length ? [`Only in JS values: ${onlyA.join(', ')}`] : []),
        ...(onlyB.length ? [`Only in DTS payload map: ${onlyB.join(', ')}`] : []),
      ],
    }, failures);
  }

  // --- Electron main must not reference non-existent MENU_ACTIONS keys or literals
  {
    const unknownKeys = uniqueSorted(Array.from(usedMenuActionKeysInMain).filter(k => !menuActionKeysJs.has(k)));
    failIf(unknownKeys.length > 0, {
      title: 'Unknown MENU_ACTIONS.<KEY> referenced in electron/main.js',
      details: unknownKeys.map(k => `MENU_ACTIONS.${k}`),
    }, failures);

    const usedLiterals = extractSendActionStringLiterals(mainSrc);
    const unknownLiterals = uniqueSorted(Array.from(usedLiterals).filter(a => !menuActionsJs.has(a)));
    failIf(unknownLiterals.length > 0, {
      title: "Unknown sendAction('...') literal referenced in electron/main.js (must be in shared MENU_ACTIONS)",
      details: unknownLiterals,
    }, failures);
  }

  // --- Renderer: menu actions referenced in code must be valid
  // And every menu action sent from main should be handled somewhere.
  {
    // Hard rule: renderer code must not import Node fs/path.
    const forbiddenNodeImports = scanRendererForForbiddenNodeImports(repoPath('src'));
    failIf(forbiddenNodeImports.length > 0, {
      title: 'Renderer must not import Node fs/path (use window.electronAPI only)',
      details: forbiddenNodeImports,
    }, failures);

    const srcFiles = listSourceFilesRecursive(repoPath('src'));

    const handlerBlocks: string[] = [];
    for (const fp of srcFiles) {
      if (!fp.endsWith('.ts') && !fp.endsWith('.tsx')) continue;
      if (fp.endsWith('.d.ts')) continue;
      const src = readText(fp);

      if (src.includes('onMenuAction')) {
        handlerBlocks.push(...extractBlocksFromOnMenuActionCallbacks(src));
      }
      // Only include typed menu handlers when MenuAction comes from the shared contract.
      if (src.includes('shared/menuActionRegistry') && src.includes('MenuAction')) {
        handlerBlocks.push(...extractBlocksFromMenuActionTypedHandlers(src));
      }
    }

    const handledActions = extractHandledMenuActionsFromHandlerSources(handlerBlocks, sharedMenuActionsByKey);

    const unknownActionLiterals = uniqueSorted(Array.from(handledActions).filter(a => !menuActionsJs.has(a)));
    failIf(unknownActionLiterals.length > 0, {
      title: 'Renderer onMenuAction handler references unknown action (not in MENU_ACTIONS)',
      details: unknownActionLiterals,
    }, failures);

    // Ensure every action that main can send is handled somewhere in src.
    // We consider "handled" if the literal string appears in an action comparison or case.
    const mainSentActionValues = new Set<string>();
    for (const k of usedMenuActionKeysInMain) {
      const v = (sharedMenuActionsByKey as any)[k];
      if (typeof v === 'string') mainSentActionValues.add(v);
    }

    const missingHandlers = uniqueSorted(Array.from(mainSentActionValues).filter(a => !handledActions.has(a)));
    failIf(missingHandlers.length > 0, {
      title: 'Menu action is sent by electron/main.js but not handled in src (action likely does nothing)',
      details: missingHandlers,
    }, failures);
  }

  // --- Non-fatal: report IPC keys that are defined but unused
  {
    const usedIpcKeys = new Set<string>([...preloadIpcUsed, ...mainIpcHandled]);
    const unused = uniqueSorted(Array.from(ipcKeysJs).filter(k => !usedIpcKeys.has(k)));
    if (unused.length > 0) {
      console.log(`[contracts] Note: IPC_CHANNELS keys defined but unused: ${unused.join(', ')}`);
    }
  }

  // Report
  if (failures.length > 0) {
    console.error('\n[contracts] Audit failed with the following issues:');
    for (const f of failures) {
      console.error(`\n- ${f.title}`);
      for (const line of f.details) console.error(`  - ${line}`);
    }
    console.error('\nFix the mismatches above to restore contract integrity.');
    process.exit(1);
  }

  console.log('[contracts] OK (IPC, preload API, menu actions)');
}

main();
