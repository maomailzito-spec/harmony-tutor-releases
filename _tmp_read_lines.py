with open('src/utils/musicTheory.ts') as f:
    lines = f.readlines()
# Read pitchClassOf at L1302 and pitchClassForRoman
for i in range(1301, 1350):
    print(f'{i+1}: {lines[i]}', end='')
print('\n--- searching for pitchClassForRoman ---')
for i, line in enumerate(lines):
    if 'pitchClassForRoman' in line and ('function' in line or 'const' in line or '=>' in line):
        for j in range(max(0,i-1), min(len(lines), i+20)):
            print(f'{j+1}: {lines[j]}', end='')
