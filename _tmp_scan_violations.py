#!/usr/bin/env python3
"""Scan musicTheory.ts for all addViolation / addDoublingViolation calls,
extract ruleId and check if description contains literal \\n."""

import re, sys

with open('src/utils/musicTheory.ts', 'r') as f:
    lines = f.readlines()

content = ''.join(lines)

# Strategy: find every addViolation({ ... }) block and addDoublingViolation(...) call
# We'll do a line-by-line scan

results = []
seen_rules = set()

def extract_rule_and_desc(block_lines, start_lineno):
    """Given a block of lines around an addViolation call, extract ruleId and description info."""
    block = '\n'.join(block_lines)
    
    # Find ruleId - try quoted first
    rule_match = re.search(r"ruleId:\s*'([^']+)'", block)
    if not rule_match:
        rule_match = re.search(r'ruleId:\s*"([^"]+)"', block)
    if not rule_match:
        rule_match = re.search(r'ruleId:\s*`([^`]+)`', block)
    if not rule_match:
        # dynamic ruleId (variable)
        rule_match = re.search(r'ruleId:\s*(\w+)', block)
    
    rule_id = rule_match.group(1) if rule_match else '???'
    
    # Find description field - check for literal \n
    # Look for description: `...` or description: '...' or description: "..." or description: variable
    # We need to handle multi-line template literals too
    
    has_literal_newline = False
    desc_type = 'UNKNOWN'
    desc_preview = ''
    
    # Check for description with backtick template literal (may span multiple lines)
    desc_bt = re.search(r'description:\s*`(.*?)(?:`|$)', block, re.DOTALL)
    desc_sq = re.search(r"description:\s*'(.*?)(?:'|$)", block, re.DOTALL)
    desc_dq = re.search(r'description:\s*"(.*?)(?:"|$)', block, re.DOTALL)
    desc_var = re.search(r'description:\s*(\w[\w.]*)', block)
    desc_tpl = re.search(r'description:\s*(`[^`]*`)', block, re.DOTALL)
    
    # Check for description built with concatenation or variables
    desc_concat = re.search(r'description:\s*([^,\n]{1,300})', block)
    
    if desc_bt:
        raw = desc_bt.group(1)
        desc_preview = raw[:150].replace('\n', '<NL>')
        if '\\n' in raw:
            has_literal_newline = True
            desc_type = 'LITERAL_NEWLINE'
        elif '\n' in desc_bt.group(1):
            # actual newline in template literal (multi-line)
            desc_type = 'TEMPLATE_MULTILINE'
        else:
            desc_type = 'TEMPLATE_SINGLE'
    elif desc_sq:
        raw = desc_sq.group(1)
        desc_preview = raw[:150]
        if '\\n' in raw:
            has_literal_newline = True
            desc_type = 'LITERAL_NEWLINE'
        else:
            desc_type = 'SINGLE_QUOTE'
    elif desc_dq:
        raw = desc_dq.group(1)
        desc_preview = raw[:150]
        if '\\n' in raw:
            has_literal_newline = True
            desc_type = 'LITERAL_NEWLINE'
        else:
            desc_type = 'DOUBLE_QUOTE'
    elif desc_var:
        var_name = desc_var.group(1)
        desc_preview = f'[var: {var_name}]'
        desc_type = 'DYNAMIC'
    
    if desc_concat and desc_type == 'UNKNOWN':
        raw = desc_concat.group(1).strip()
        desc_preview = raw[:150]
        if '\\n' in raw:
            has_literal_newline = True
            desc_type = 'LITERAL_NEWLINE'
        else:
            desc_type = 'DYNAMIC_OR_COMPLEX'
    
    return rule_id, desc_type, has_literal_newline, desc_preview

i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    
    # Detect addViolation({ or addDoublingViolation(
    is_add_violation = 'addViolation({' in stripped or 'addViolation( {' in stripped
    is_doubling = 'addDoublingViolation(' in stripped and 'const addDoublingViolation' not in stripped
    
    if is_add_violation or is_doubling:
        # Gather block: up to 25 lines after
        block_lines = [l.rstrip() for l in lines[max(0,i):min(len(lines),i+25)]]
        rule_id, desc_type, has_nl, preview = extract_rule_and_desc(block_lines, i+1)
        results.append((i+1, rule_id, desc_type, has_nl, preview))
    
    i += 1

# Also find addViolation that spans two lines like:
#   addViolation(
#     { ruleId: ...
i = 0
while i < len(lines) - 1:
    line = lines[i].strip()
    next_line = lines[i+1].strip() if i+1 < len(lines) else ''
    if line.endswith('addViolation(') or (line == 'addViolation(' and next_line.startswith('{')):
        block_lines = [l.rstrip() for l in lines[max(0,i):min(len(lines),i+25)]]
        rule_id, desc_type, has_nl, preview = extract_rule_and_desc(block_lines, i+1)
        # Avoid duplicates
        if not any(r[0] == i+1 for r in results):
            results.append((i+1, rule_id, desc_type, has_nl, preview))
    i += 1

# Sort by line number
results.sort(key=lambda x: x[0])

# Deduplicate by (lineno)
seen = set()
deduped = []
for r in results:
    if r[0] not in seen:
        seen.add(r[0])
        deduped.append(r)

# Print report
print("=" * 100)
print(f"TOTAL addViolation / addDoublingViolation calls found: {len(deduped)}")
print("=" * 100)

# Group by ruleId
from collections import defaultdict
by_rule = defaultdict(list)
for lineno, rid, dtype, has_nl, preview in deduped:
    by_rule[rid].append((lineno, dtype, has_nl, preview))

# Print grouped
literal_nl_rules = []
no_nl_rules = []

for rid in sorted(by_rule.keys()):
    entries = by_rule[rid]
    any_nl = any(e[2] for e in entries)
    if any_nl:
        literal_nl_rules.append(rid)
    else:
        no_nl_rules.append(rid)

print("\n✅ RULES WITH LITERAL \\n IN DESCRIPTION:")
print("-" * 80)
for rid in literal_nl_rules:
    for lineno, dtype, has_nl, preview in by_rule[rid]:
        marker = "🔵" if has_nl else "  "
        print(f"  {marker} L{lineno:5d} | ruleId={rid:25s} | type={dtype:20s} | desc={preview[:90]}")

print(f"\n❌ RULES WITHOUT LITERAL \\n (need completion):")
print("-" * 80)
for rid in no_nl_rules:
    for lineno, dtype, has_nl, preview in by_rule[rid]:
        print(f"     L{lineno:5d} | ruleId={rid:25s} | type={dtype:20s} | desc={preview[:90]}")

print("\n" + "=" * 100)
print(f"SUMMARY: {len(literal_nl_rules)} rules with literal \\n, {len(no_nl_rules)} rules without")
print(f"Rules with \\n: {', '.join(literal_nl_rules)}")
print(f"Rules without: {', '.join(no_nl_rules)}")
