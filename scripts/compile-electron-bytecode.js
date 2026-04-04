/**
 * compile-electron-bytecode.js
 *
 * Compiles electron/main.js and electron/preload.js (+ licensing modules)
 * to V8 bytecode (.jsc) for the production build.
 *
 * Run AFTER `npm run build` and BEFORE `electron-builder`:
 *   node scripts/compile-electron-bytecode.js
 *
 * The original .js files are replaced with tiny loaders that require the .jsc.
 * This prevents casual reading/modification of the licensing logic.
 */
const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

const ELECTRON_DIR = path.resolve(__dirname, '..', 'electron');

const FILES_TO_COMPILE = [
  'main.js',
  'preload.js',
  'licensing/trialManager.js',
  'licensing/licenseManager.js',
  'licensing/licenseCrypto.js',
  'licensing/machineId.js',
];

async function compile() {
  for (const relPath of FILES_TO_COMPILE) {
    const srcPath = path.join(ELECTRON_DIR, relPath);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[skip] ${relPath} not found`);
      continue;
    }

    const jscPath = srcPath.replace(/\.js$/, '.jsc');

    console.log(`[compile] ${relPath} → ${path.basename(jscPath)}`);
    await bytenode.compileFile(srcPath, jscPath);

    // Replace the original .js with a tiny loader
    const loaderContent = `'use strict';\nrequire('bytenode');\nmodule.exports = require('${'./' + path.basename(jscPath)}');\n`;
    fs.writeFileSync(srcPath, loaderContent, 'utf8');
  }

  console.log('\n✅ All files compiled to V8 bytecode.');
  console.log('Remember to include bytenode in production dependencies.');
}

compile().catch(err => {
  console.error('Bytecode compilation failed:', err);
  process.exit(1);
});
