import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RULE_TEXTS } from '../src/utils/ruleTexts';

const out: Record<string, { body: string; suggestion: string }> = {};
for (const [k, v] of Object.entries(RULE_TEXTS)) {
  out[k] = { body: v.body || '', suggestion: v.suggestion || '' };
}
const target = resolve(__dirname, '../src/locales/it/ruleTexts.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`Wrote ${Object.keys(out).length} rules to ${target}`);
