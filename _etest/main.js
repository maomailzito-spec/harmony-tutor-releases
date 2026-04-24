const natives = process.binding('natives');
const bi = natives['electron/js2c/browser_init'].toString();
// The electron module is at "./lib/browser/api/exports/electron.ts"
// Find what this exports and how it's made available to user code
const allElectronTsRefs = [];
let pos = 0;
while (true) {
  const idx = bi.indexOf('electron.ts', pos);
  if (idx < 0) break;
  allElectronTsRefs.push(bi.slice(Math.max(0,idx-100), idx+100));
  pos = idx + 1;
}
process.stdout.write('Total electron.ts references: ' + allElectronTsRefs.length + '\n');
allElectronTsRefs.forEach((ref, i) => process.stdout.write(i + ': ' + ref + '\n\n'));
setTimeout(() => process.exit(0), 300);
