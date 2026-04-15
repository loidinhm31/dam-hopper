import sys

with open('packages/web/public/favicon.svg', 'r') as f:
    lines = f.readlines()

new_lines = []
path_count = 0
for line in lines:
    if '<path' in line:
        path_count += 1
        if path_count <= 2:
            continue
    new_lines.append(line)

with open('packages/web/public/favicon.svg', 'w') as f:
    f.writelines(new_lines)
