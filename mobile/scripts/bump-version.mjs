// Usage: node scripts/bump-version.mjs <major|minor|patch>
// Keeps package.json and app.json in step; the app shows this number under
// the "Splitkhata" header (see lib/version.js).
import { readFileSync, writeFileSync } from 'node:fs';

const kind = process.argv[2];
if (!['major', 'minor', 'patch'].includes(kind)) {
  console.error('Usage: node scripts/bump-version.mjs <major|minor|patch>');
  process.exit(1);
}

const pkgPath = new URL('../package.json', import.meta.url);
const appPath = new URL('../app.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = kind === 'major' ? `${maj + 1}.0.0` : kind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const app = JSON.parse(readFileSync(appPath, 'utf8'));
app.expo.version = next;
writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
console.log(next);
