import * as fs from 'fs';
import * as path from 'path';

// Read regression output and parse FAIL lines with their detail
const regOut = fs.readFileSync('/tmp/regress_out.txt', 'utf-8');
const lines = regOut.split('\n');

interface FileDiff {
  name: string;
  failCount: number;
  details: string[];
}

const fileMap = new Map<string, FileDiff>();
let currentFile = '';

for (const line of lines) {
  if (line.startsWith('FAIL')) {
    // Extract test name
    const match = line.match(/^FAIL\s+(.+?)(?:\s+\((?:snapshot|gold)\))?$/);
    if (match) {
      currentFile = match[1].trim();
      if (!fileMap.has(currentFile)) {
        fileMap.set(currentFile, { name: currentFile, failCount: 0, details: [] });
      }
      fileMap.get(currentFile)!.failCount++;
    }
  } else if (line.trim().startsWith('expected') || line.trim().startsWith('got') || line.trim().startsWith('diff')) {
    if (currentFile && fileMap.has(currentFile)) {
      fileMap.get(currentFile)!.details.push(line.trim());
    }
  }
}

// Sort by fail count
const sorted = [...fileMap.values()].sort((a, b) => b.failCount - a.failCount);

console.log('Files with most FAIL assertions:');
for (const f of sorted.slice(0, 20)) {
  console.log(`  ${f.name}: ${f.failCount} fails`);
  for (const d of f.details.slice(0, 3)) {
    console.log(`    ${d}`);
  }
}
