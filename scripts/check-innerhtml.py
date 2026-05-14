import re, sys, pathlib

RAW_INTERP = re.compile(r'\$\{(?!escapeHtml\()(?!escapeAttr\()(?![0-9\s\`\'\"])(?![a-zA-Z_.]+\.length)')
INNER_HTML = re.compile(r'\.innerHTML\s*[+=]\s*`[^`]*`', re.DOTALL)

issues = []
for path in pathlib.Path('assets/js').rglob('*.js'):
    src = path.read_text()
    for m in INNER_HTML.finditer(src):
        block = m.group(0)
        for bad in RAW_INTERP.finditer(block):
            line = src[:m.start() + bad.start()].count('\n') + 1
            issues.append(f"{path}:{line}: unescaped interpolation in innerHTML")

if issues:
    for i in issues:
        print(i)
    sys.exit(1)
else:
    print("No innerHTML audit issues found")
