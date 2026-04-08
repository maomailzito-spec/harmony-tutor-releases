import fs from 'node:fs';
import assert from 'node:assert/strict';

import { extractProjectExtras, migrateProjectData, CURRENT_PROJECT_SCHEMA_VERSION } from '../src/storage/projectSchema';

function main() {
  // Use a real repo fixture as “legacy” input (no schemaVersion today).
  const fixturePath = 'tests/Bach corale 19.json';
  const rawText = fs.readFileSync(fixturePath, 'utf-8');
  const parsed = JSON.parse(rawText);

  // Simulate a future/unknown field that must survive a load+save round-trip.
  (parsed as any).__futureField = { nested: { n: 123 }, arr: [1, 2, 3] };

  // Legacy condition: schemaVersion absent.
  assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion'), 'fixture unexpectedly has schemaVersion');

  // “Open”: migration + extract extras
  const extras = extractProjectExtras(parsed);
  const migrated = migrateProjectData(parsed);

  assert.equal(migrated.schemaVersion, CURRENT_PROJECT_SCHEMA_VERSION, 'migrateProjectData must set schemaVersion to current');
  assert.ok(Array.isArray(migrated.notes), 'migrated.notes must be an array');
  assert.ok(extras.__futureField, 'extras must preserve unknown future fields');

  // “Save”: renderer merges extras first, then overwrites known keys.
  const baseProject = {
    ...migrated,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  };
  const mergedForSave = { ...extras, ...baseProject } as any;

  assert.equal(mergedForSave.schemaVersion, CURRENT_PROJECT_SCHEMA_VERSION, 'saved project must include schemaVersion');
  assert.deepEqual(mergedForSave.__futureField, (parsed as any).__futureField, 'future fields must be preserved across save');
  assert.ok(Array.isArray(mergedForSave.notes), 'saved project must have notes array');

  // Serialize check (ensures it’s JSON-safe and schemaVersion is present in output)
  const out = JSON.stringify(mergedForSave);
  assert.ok(out.includes('"schemaVersion"'), 'serialized output must contain schemaVersion');

  console.log('[smoke] OK legacy project migration + forward-compat round-trip');
}

main();
