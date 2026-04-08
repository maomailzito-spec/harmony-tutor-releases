#!/usr/bin/env python3
"""
Phase 2 Step 2: Replace the harmony block in GrandStaffEditor.tsx with hook call.
Run AFTER scripts/_build_harmony_hook.py has created useHarmonyLabels.ts.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "components", "GrandStaffEditor.tsx")

with open(SRC, "r", encoding="utf-8") as f:
    lines = f.readlines()

print(f"Original GrandStaffEditor.tsx: {len(lines)} lines")

# Verify boundaries
assert "harmonyLabelsBySystem" in lines[2786], f"Line 2787 mismatch: {lines[2786][:80]}"
# Line 5963 should be an empty line or the end of the timeSignatureMarkersBySystem block
# Line 5964 (index 5963) should be: "    // Violations -> noteId -> level"

# Find the exact after-block line by searching for "Violations"
after_idx = None
for i in range(5960, 5970):
    if i < len(lines) and "Violations" in lines[i]:
        after_idx = i
        break

if after_idx is None:
    # Scan wider
    for i in range(5950, 5980):
        if i < len(lines) and "violationLevel" in lines[i].lower():
            after_idx = i
            break

assert after_idx is not None, "Could not find 'Violations' marker after harmony block"
print(f"Found 'Violations' marker at line {after_idx + 1}")

# The block to replace is lines[2786:after_idx] (before the Violations line)
# But we want to keep the ADAPTER LAYER comment header (lines 2782-2786)
# Actually, lines 2782-2786 are:
# 2783: // =========================================================
# 2784: // ADAPTER LAYER (domain -> overlay data) 
# 2785: // =========================================================
# 2786: (empty line)
# 2787: // Timeline-based harmony labels...
# The block starts at line 2787 (index 2786).

replacement = """    // ADAPTER LAYER — harmony analysis overlay data (extracted to useHarmonyLabels hook)
    const { harmonyLabelsBySystemSequenced, progressionMarkersBySystem, sequenceMarkersBySystem, sequenceModelMarkersBySystem, contextMarkersBySystem, timeSignatureMarkersBySystem, sequenceMatches } = useHarmonyLabels({
        layoutData, timeSignature, timeSignatureChanges, analysisContexts, harmonyOverrides,
        currentTonic, isMinorMode, isAnalysisEnabled, isSequencesEnabled,
        staffSystemMode, notes, analyzedNotes, analysisContextAbsBeat, timeSignatureChangeAbsBeat,
    });

"""

new_lines = lines[:2786] + [replacement] + lines[after_idx:]

# Also add import for useHarmonyLabels
# Find where to insert (after useEditorZoom import)
import_line = "import { useHarmonyLabels } from '../hooks/useHarmonyLabels';\n"
import_inserted = False
for i, line in enumerate(new_lines):
    if "useEditorZoom" in line and "import" in line:
        new_lines.insert(i + 1, import_line)
        import_inserted = True
        break

if not import_inserted:
    # Find any import line and add after it
    for i, line in enumerate(new_lines):
        if line.startswith("import ") and "from" in line and i > 10:
            new_lines.insert(i + 1, import_line)
            import_inserted = True
            break

assert import_inserted, "Could not insert import for useHarmonyLabels"

with open(SRC, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print(f"Updated GrandStaffEditor.tsx: {len(new_lines)} lines")
removed = len(lines) - len(new_lines)
print(f"  Removed ~{removed} lines")
