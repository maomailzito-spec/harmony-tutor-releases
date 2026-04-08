import re, sys

with open('src/components/GrandStaffEditor.tsx', 'r') as f:
    lines = f.readlines()

blocks = []
patterns = [
    (r'const (\w+) = useMemo\(', 'useMemo'),
    (r'const (\w+) = useCallback\(', 'useCallback'),
    (r'useEffect\(\(\) =>', 'useEffect'),
    (r'useLayoutEffect\(\(\) =>', 'useLayoutEffect'),
]

i = 0
while i < len(lines):
    line = lines[i]
    for pat, kind in patterns:
        m = re.search(pat, line)
        if m:
            name = m.group(1) if m.lastindex else kind
            start = i + 1
            depth = 0
            j = i
            while j < len(lines):
                for ch in lines[j]:
                    if ch == '(':
                        depth += 1
                    elif ch == ')':
                        depth -= 1
                j += 1
                if depth <= 0:
                    break
            end = j
            size = end - start + 1
            if size >= 20:
                blocks.append((start, end, size, kind, name))
            break
    i += 1

blocks.sort(key=lambda x: -x[2])
print(f'Found {len(blocks)} blocks >= 20 lines:')
print(f'{"Start":>6} {"End":>6} {"Size":>5} {"Kind":<14} Name')
print('-' * 70)
for start, end, size, kind, name in blocks:
    print(f'{start:6} {end:6} {size:5} {kind:<14} {name}')
