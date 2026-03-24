import re
import sys

def check_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Simple regex to find imports
    # This is not perfect but should work for this case
    import_matches = re.findall(r'import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', content, re.MULTILINE)

    all_imports = []
    for imports, source in import_matches:
        for imp in imports.split(','):
            imp = imp.strip()
            if not imp: continue
            # Handle 'as' imports
            if ' as ' in imp:
                imp = imp.split(' as ')[1].strip()
            all_imports.append(imp)

    # Also find single imports like import X from 'y'
    single_imports = re.findall(r'import\s+([a-zA-Z0-9_]+)\s+from\s+[\'"]([^\'"]+)[\'"]', content)
    for imp, source in single_imports:
        all_imports.append(imp)

    # Remove the imports section to check usage in the rest of the file
    lines = content.split('\n')
    # Find the end of imports
    last_import_line = 0
    for i, line in enumerate(lines):
        if line.strip().startswith('import'):
            last_import_line = i

    # We assume imports are at the top.
    # Let's just filter out any line that starts with import or is part of a multiline import.
    # Actually, just looking for usage in body is better.
    body = '\n'.join(lines[last_import_line+1:])

    unused = []
    for imp in all_imports:
        # Check if imp is used in body
        if not re.search(r'\b' + re.escape(imp) + r'\b', body):
            unused.append(imp)

    return unused

if __name__ == "__main__":
    unused = check_file('src/app/performance/page.tsx')
    print("Unused imports:", unused)
