// Usage: node scripts/bump-version.mjs <major|minor|patch>
// Keeps package.json, package-lock.json and app.json in step; the app shows
// this number under the "Splitkhata" header (see lib/version.js). Also
// increments the native build numbers (iOS buildNumber, Android versionCode),
// which were never set, so every native build reported itself as build 1.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const kind = process.argv[2];
if (!['major', 'minor', 'patch'].includes(kind)) {
  console.error('Usage: node scripts/bump-version.mjs <major|minor|patch>');
  process.exit(1);
}

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const writeJson = (url, value) => writeFileSync(url, JSON.stringify(value, null, 2) + '\n');

const pkgPath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const appPath = new URL('../app.json', import.meta.url);

const pkg = readJson(pkgPath);
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = kind === 'major' ? `${maj + 1}.0.0` : kind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
writeJson(pkgPath, pkg);

if (existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  writeJson(lockPath, lock);
}

const app = readJson(appPath);
app.expo.version = next;
app.expo.ios = app.expo.ios || {};
const build = (Number(app.expo.ios.buildNumber) || 0) + 1;
app.expo.ios.buildNumber = String(build);
app.expo.android = app.expo.android || {};
app.expo.android.versionCode = build;
writeJson(appPath, app);

console.log(next);
console.log(`build ${build}`);
