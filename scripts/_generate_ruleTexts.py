#!/usr/bin/env python3
"""Generate updated src/utils/ruleTexts.ts from parsed HTML rules JSON."""
import json, os, re

BASE = os.path.join(os.path.dirname(__file__), '..')
JSON_PATH = os.path.join(BASE, 'logs', '_parsed_rules.json')
OUT_PATH = os.path.join(BASE, 'src', 'utils', 'ruleTexts.ts')

# Rules whose body MUST stay '' because they have inline text in musicTheory.ts
# that already contains '\n' and the auto-enrich logic skips them.
KEEP_EMPTY_BODY = {
    'R-01', 'R-02', 'R-05', 'R-10', 'R-10-3RD', 'R-10-6',
    'R-10-7TH', 'R-10-DIM5', 'R-10-64',
    'R-12', 'R-17a', 'R-17b', 'R-17c',
}

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    rules = json.load(f)

# Build lookup: id -> {body, suggestion}
doc_texts = {r['id']: r for r in rules}

def escape_ts(s: str) -> str:
    """Escape string for TypeScript single-quoted string literal."""
    return s.replace('\\', '\\\\').replace("'", "\\'")

def body_to_ts_array(text: str, indent: str = '      ') -> str:
    """Convert multi-line body text to TypeScript array .join('\\n')."""
    lines = text.split('\n')
    # Clean up empty lines at start/end
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return f"{indent}body: '',"
    if len(lines) == 1:
        return f"{indent}body: '{escape_ts(lines[0])}',"
    parts = []
    parts.append(f"{indent}body: [")
    for line in lines:
        parts.append(f"{indent}  '{escape_ts(line)}',")
    parts.append(f"{indent}].join('\\n'),")
    return '\n'.join(parts)

# All 63 rule IDs in desired order
ALL_RULES_ORDERED = [
    # Section 1: Errors
    'R-01', 'R-02', 'R-02c', 'R-04', 'R-06', 'R-07', 'R-09',
    'R-10', 'R-10-7TH', 'R-10-DIM5', 'R-10-64', 'R-10-3RD', 'R-10-6',
    'R-12', 'R-17a',
    'R-N-RES', 'R-AUG6-RES', 'R-CAD64',
    # Section 2: Warnings
    'R-03', 'R-05', 'R-08', 'R-13', 'R-14', 'R-15', 'R-16',
    'R-17b', 'R-17c',
    'R-CHORD-COMPLETE', 'R-RANGE', 'R-SPACING-TB',
    # Section 3: Exceptions - Parallel/Hidden
    'EXC-M03', 'EXC-M04', 'EXC-OBL-PERF', 'EXC-Hidden-Stepwise', 'EXC-Hidden-BassStep',
    # Section 4: Exceptions - Crossing/Unison
    'EXC-S02', 'EXC-Unison-Lower', 'EXC-Unison-Step', 'EXC-Unison-Cadence',
    # Section 5: Exceptions - Leading Tone
    'EXC-LT-Transfer', 'EXC-LT-Chromatic-Line',
    # Section 6: Exceptions - 7th Resolution
    'EXC-7-TRANSFERRED-RES', 'EXC-7-UP', 'EXC-7-P4-TO7', 'EXC-7-STATIC',
    'EXC-7-DELAYED', 'EXC-7m01', 'EXC-7-TRANSFER', 'EXC-7-FREE',
    # Section 7: Exception - Melody
    'EXC-R17-Duration',
    # Section 8: Ornaments
    'ORN-NEIGH', 'R-ORN-NEIGH', 'ORN-APP', 'R-ORN-APP',
    'ORN-ANT', 'R-ORN-ANT', 'ORN-ESC', 'R-ORN-ESC', 'ORN-PASS',
    # Section 9: Cadences
    'CAD-PAC', 'CAD-IAC', 'CAD-HC', 'CAD-PLAG',
]

SECTION_COMMENTS = {
    'R-01': "  // ═══════════════════════════════════════════════════════════\n  // 1. ERRORI DI CONDOTTA VOCALE (error)\n  // ═══════════════════════════════════════════════════════════\n",
    'R-03': "\n  // ═══════════════════════════════════════════════════════════\n  // 2. AVVERTIMENTI DI CONDOTTA VOCALE (warning)\n  // ═══════════════════════════════════════════════════════════\n",
    'EXC-M03': "\n  // ═══════════════════════════════════════════════════════════\n  // 3. ECCEZIONI — PARALLELE / NASCOSTE (exception)\n  // ═══════════════════════════════════════════════════════════\n",
    'EXC-S02': "\n  // ═══════════════════════════════════════════════════════════\n  // 4. ECCEZIONI — INCROCIO E UNISONO (exception)\n  // ═══════════════════════════════════════════════════════════\n",
    'EXC-LT-Transfer': "\n  // ═══════════════════════════════════════════════════════════\n  // 5. ECCEZIONI — SENSIBILE (exception)\n  // ═══════════════════════════════════════════════════════════\n",
    'EXC-7-TRANSFERRED-RES': "\n  // ═══════════════════════════════════════════════════════════\n  // 6. ECCEZIONI — RISOLUZIONE DELLA SETTIMA (exception)\n  // ═══════════════════════════════════════════════════════════\n",
    'EXC-R17-Duration': "\n  // ═══════════════════════════════════════════════════════════\n  // 7. ECCEZIONE — MELODIA (exception)\n  // ═══════════════════════════════════════════════════════════\n",
    'ORN-NEIGH': "\n  // ═══════════════════════════════════════════════════════════\n  // 8. ORNAMENTI (exception / warning)\n  // ═══════════════════════════════════════════════════════════\n",
    'CAD-PAC': "\n  // ═══════════════════════════════════════════════════════════\n  // 9. CADENZE — MARKER INFORMATIVI (exception)\n  // ═══════════════════════════════════════════════════════════\n",
}

# Notes for rules with empty body
EMPTY_NOTES = {
    'R-01': '// body generato da _dubDesc inline → qui vuoto',
    'R-02': '// body generato da _dubDesc inline → qui vuoto',
    'R-05': '// body generato da _desc inline → qui vuoto',
    'R-10': '// body generato da addDoublingViolation inline → qui vuoto',
    'R-10-7TH': '// body con suggestion inline → qui vuoto',
    'R-10-DIM5': '// body con suggestion inline → qui vuoto',
    'R-10-64': '// body con suggestion inline → qui vuoto',
    'R-10-3RD': '// ha generic inline → qui vuoto',
    'R-10-6': '// ha generic inline → qui vuoto',
    'R-12': '// body generato da template dinamico inline → qui vuoto',
    'R-17a': '// ha body literal inline → qui vuoto',
    'R-17b': '// ha body literal inline → qui vuoto',
    'R-17c': '// ha body literal inline → qui vuoto',
}

# Generate the file
lines = []
lines.append('/**')
lines.append(' * ruleTexts.ts — Registro centralizzato dei testi educativi per le regole.')
lines.append(' *')
lines.append(' * Ogni regola ha:')
lines.append(' *   - body:       testo multi-riga espandibile (visibile cliccando ▼ nel pannello).')
lines.append(' *                 Se vuoto (\'\'), non viene aggiunto al description.')
lines.append(' *   - suggestion: consiglio mostrato come "Consiglio:" nel pannello.')
lines.append(' *                 Se vuoto (\'\'), il caller inline prevale.')
lines.append(' *')
lines.append(' * ━━━ Come funziona l\'auto-enrichment ━━━')
lines.append(' * `addViolation()` in musicTheory.ts consulta questo registro:')
lines.append(' *   1. Se description NON contiene \'\\n\' E body ≠ \'\', appende \'\\n\' + body.')
lines.append(' *   2. Se suggestion del caller è undefined/vuota E suggestion ≠ \'\', usa quella del registro.')
lines.append(' *')
lines.append(' * ━━━ Rendering (HarmonyAnalysisPanel.tsx) ━━━')
lines.append(' *   description.split(\'\\n\') → riga 0 = intestazione (sempre visibile), righe 1+ = dettaglio ▼.')
lines.append(' */')
lines.append('')
lines.append('export interface RuleText {')
lines.append('  /** Testo educativo espandibile (righe 2+). Vuoto = nessun body aggiuntivo. */')
lines.append('  body: string;')
lines.append('  /** Consiglio ("Consiglio:"). Vuoto = il caller inline prevale. */')
lines.append('  suggestion: string;')
lines.append('}')
lines.append('')
lines.append('// ────────────────────────────────────────────────────────────')
lines.append('// REGISTRO')
lines.append('// ────────────────────────────────────────────────────────────')
lines.append('')
lines.append('export const RULE_TEXTS: Record<string, RuleText> = {')

for rid in ALL_RULES_ORDERED:
    # Section comment?
    if rid in SECTION_COMMENTS:
        lines.append(SECTION_COMMENTS[rid])

    # Should body stay empty?
    if rid in KEEP_EMPTY_BODY:
        note = EMPTY_NOTES.get(rid, '')
        sugg = ''
        if rid in doc_texts:
            sugg = doc_texts[rid].get('suggestion', '')
        if note:
            lines.append(f"  {note}")
        if sugg:
            lines.append(f"  '{rid}': {{ body: '', suggestion: '{escape_ts(sugg)}' }},")
        else:
            lines.append(f"  '{rid}': {{ body: '', suggestion: '' }},")
        lines.append('')
        continue

    # Use text from doc if available, otherwise empty
    if rid in doc_texts:
        body_text = doc_texts[rid]['body']
        sugg_text = doc_texts[rid]['suggestion']
    else:
        body_text = ''
        sugg_text = ''

    lines.append(f"  '{rid}': {{")
    lines.append(body_to_ts_array(body_text))
    if sugg_text:
        lines.append(f"    suggestion: '{escape_ts(sugg_text)}',")
    else:
        lines.append(f"    suggestion: '',")
    lines.append(f"  }},")
    lines.append('')

lines.append('};')
lines.append('')
lines.append('// ────────────────────────────────────────────────────────────')
lines.append('// API')
lines.append('// ────────────────────────────────────────────────────────────')
lines.append('')
lines.append('/** Ottiene body + suggestion per una regola. Fallback sicuro se la regola non è nel registro. */')
lines.append('export function getRuleText(ruleId: string): RuleText {')
lines.append("  return RULE_TEXTS[ruleId] ?? { body: '', suggestion: '' };")
lines.append('}')
lines.append('')

output = '\n'.join(lines)
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Generated {OUT_PATH}")
print(f"  Total entries: {len(ALL_RULES_ORDERED)}")
print(f"  From doc: {len([r for r in ALL_RULES_ORDERED if r in doc_texts])}")
print(f"  Kept empty: {len([r for r in ALL_RULES_ORDERED if r in KEEP_EMPTY_BODY])}")
