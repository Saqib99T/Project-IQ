#!/usr/bin/env python3
"""
Auto-increment version and build number.
Usage: python bump_version.py
"""
import json, re

# --- app.json ---
with open('app.json', 'r') as f:
    app = json.load(f)

old_version = app['expo']['version']
parts = old_version.split('.')
parts[-1] = str(int(parts[-1]) + 1)
new_version = '.'.join(parts)

old_build = int(app['expo']['android']['versionCode'])
new_build = old_build + 1

app['expo']['version'] = new_version
app['expo']['ios']['buildNumber'] = str(new_build)
app['expo']['android']['versionCode'] = new_build

with open('app.json', 'w') as f:
    json.dump(app, f, indent=2)

print(f'app.json: {old_version} -> {new_version}  |  build {old_build} -> {new_build}')

# --- build.gradle ---
gradle_path = 'android/app/build.gradle'
with open(gradle_path, 'r') as f:
    gradle = f.read()

gradle = re.sub(r'versionCode \d+', f'versionCode {new_build}', gradle)
gradle = re.sub(r'versionName "[^"]+"', f'versionName "{new_version}"', gradle)

with open(gradle_path, 'w') as f:
    f.write(gradle)

print(f'build.gradle: versionCode {new_build}  |  versionName "{new_version}"')

# --- package.json ---
with open('package.json', 'r') as f:
    pkg_text = f.read()
pkg_text = pkg_text.replace(f'"version": "{old_version}"', f'"version": "{new_version}"', 1)
with open('package.json', 'w') as f:
    f.write(pkg_text)
print(f'package.json: {new_version}')

# --- package-lock.json (regex to target top-level and packages[""] independently) ---
with open('package-lock.json', 'r') as f:
    lock_text = f.read()
# Top-level version (first occurrence of "version": "..." near the top)
lock_text = re.sub(r'^(\s*"version":\s*")[^"]+(")', rf'\g<1>{new_version}\2', lock_text, count=1, flags=re.MULTILINE)
# packages[""] version (after the `"": {` block)
lock_text = re.sub(r'("packages":\s*\{[^}]*?""\s*:\s*\{[^}]*?"version":\s*")[^"]+(")', rf'\g<1>{new_version}\2', lock_text, count=1, flags=re.DOTALL)
with open('package-lock.json', 'w') as f:
    f.write(lock_text)
print(f'package-lock.json: {new_version}')

print('Done.')
