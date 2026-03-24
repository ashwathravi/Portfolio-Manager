import re

with open('src/app/performance/page.tsx', 'r') as f:
    content = f.read()

imported_names = set()

# Handle multiline braced imports
multiline_braced = re.findall(r'import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', content, re.DOTALL)
for names_str, source in multiline_braced:
    for name in names_str.split(','):
        name = name.strip()
        if not name: continue
        if ' as ' in name:
            imported_names.add(name.split(' as ')[1].strip())
        else:
            imported_names.add(name)

# Handle default imports
default_imports = re.findall(r'import\s+([a-zA-Z0-9_]+)\s+from\s+[\'"]([^\'"]+)[\'"]', content)
for name, source in default_imports:
    if name != 'import': # avoid matching inside strings if any
        imported_names.add(name)

# Extract code body (after last import)
import_matches = list(re.finditer(r'import.*?;', content, re.DOTALL))
if import_matches:
    last_end = import_matches[-1].end()
    code_body = content[last_end:]
else:
    code_body = content

# Also consider names used in the imports themselves if they are used elsewhere? No.
used_names = set(re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', code_body))

unused = imported_names - used_names
print("Unused:", sorted(list(unused)))
