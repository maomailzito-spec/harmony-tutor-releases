import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'tests');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.htp'));
const ok: string[] = [];
const skip: string[] = [];

for (const f of files) {
  try {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const data = JSON.parse(raw);
    const notes = data.notes || data.rawNotes || [];
    const voices = new Set(
      notes.filter((n: any) => n && !n.isRest).map((n: any) => n.voice || 1)
    );
    if (voices.size >= 4) ok.push(f);
    else skip.push(`${f}  (voci: ${voices.size})`);
  } catch {
    skip.push(`${f}  (errore parsing)`);
  }
}

console.log(`\n=== ANALIZZATI (${ok.length}) ===`);
ok.forEach(s => console.log(`  ✓ ${s}`));
console.log(`\n=== SCARTATI (${skip.length}) ===`);
skip.forEach(s => console.log(`  ✗ ${s}`));
