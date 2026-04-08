#!/usr/bin/env python3
"""Revert all appoggiatura-specific additions from useHarmonyLabels.ts"""

with open('src/hooks/useHarmonyLabels.ts', 'r') as f:
    content = f.read()

# 1. Remove ornOverrideLookaheadRoman helper (comment block + function)
marker_start = '            // Resolution look-ahead for ornament overrides: when filtering an\n'
marker_end_func = "                } catch { return ''; }\n            };\n"
i1 = content.find(marker_start)
i2 = content.find(marker_end_func, i1) + len(marker_end_func)
# Also remove trailing blank line
if i2 < len(content) and content[i2] == '\n':
    i2 += 1
if i1 >= 0 and i2 > i1:
    content = content[:i1] + content[i2:]
    print(f'1. Removed ornOverrideLookaheadRoman helper (chars {i1}-{i2})')
else:
    print(f'WARNING 1: not found i1={i1} i2={i2}')

# 2. Fix previewRoman fallback: replace 'ornOverrideLookaheadRoman() || ""' with '""'
old_prev = "                    return ornOverrideLookaheadRoman() || '';"
new_prev = "                    return '';"
if old_prev in content:
    content = content.replace(old_prev, new_prev)
    print('2. Reverted previewRoman fallback')
else:
    print('WARNING 2: previewRoman fallback not found')

# 3. Remove hasOrnOverrideHere variable and its comment
old_hasOrn = """            // Check if current beat has a user ornament override (appoggiatura etc.)
            // — treat like suspension onset: force a fresh Roman label.
            const hasOrnOverrideHere = (fullNotes || []).some((n: any) =>
                n && !n.isRest && n.ornamentOverride && n.ornamentOverride !== 'structural');

"""
if old_hasOrn in content:
    content = content.replace(old_hasOrn, '')
    print('3. Removed hasOrnOverrideHere variable')
else:
    print('WARNING 3: hasOrnOverrideHere not found exactly, trying looser match')
    # Try without trailing blank line
    old_hasOrn2 = """            // Check if current beat has a user ornament override (appoggiatura etc.)
            // — treat like suspension onset: force a fresh Roman label.
            const hasOrnOverrideHere = (fullNotes || []).some((n: any) =>
                n && !n.isRest && n.ornamentOverride && n.ornamentOverride !== 'structural');"""
    if old_hasOrn2 in content:
        content = content.replace(old_hasOrn2 + '\n', '')
        print('3. Removed hasOrnOverrideHere variable (loose match)')
    else:
        print('WARNING 3: still not found')

# 4. Remove !hasOrnOverrideHere from suppression if
old_if = '            if (!hasSuspensionOnsetHere && !hasOrnOverrideHere && !hasHiddenChange'
new_if = '            if (!hasSuspensionOnsetHere && !hasHiddenChange'
if old_if in content:
    content = content.replace(old_if, new_if)
    print('4. Removed !hasOrnOverrideHere from suppression if')
else:
    print('WARNING 4: suppression if not found')

# 5. Remove main roman fallback block
old_fallback = """                // Resolution look-ahead fallback for ornament overrides.
                if (!roman) {
                    const rl = ornOverrideLookaheadRoman();
                    if (rl) { roman = rl; isAug6Roman = (roman === 'It+' || roman === 'Fr+' || roman === 'Ger+'); }
                }
"""
if old_fallback in content:
    content = content.replace(old_fallback, '')
    print('5. Removed main roman fallback')
else:
    print('WARNING 5: main roman fallback not found')

with open('src/hooks/useHarmonyLabels.ts', 'w') as f:
    f.write(content)

print('Done!')
