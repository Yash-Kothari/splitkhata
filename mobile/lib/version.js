import pkg from '../package.json';

// The build sha is injected by CI (EXPO_PUBLIC_BUILD_SHA) so a deployed build
// is identifiable even if the version number wasn't bumped; local runs show
// just the version.
const sha = (process.env.EXPO_PUBLIC_BUILD_SHA || '').slice(0, 7);

export const APP_VERSION = pkg.version;
export const VERSION_LABEL = `v${pkg.version}`;
export const BUILD_SHA = sha;
