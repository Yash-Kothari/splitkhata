// Dynamic wrapper around app.json. For the admin edition (EXPO_PUBLIC_EDITION unset) it returns app.json's
// config untouched, so nothing about the existing build changes. The shared edition is hosted at the root of
// its own Firebase Hosting site instead of under /splitkhata, so it drops the base URL (see lib/edition.js).
module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_EDITION !== 'shared') return config;
  const { baseUrl: _adminBaseUrl, ...experiments } = config.experiments || {};
  return {
    ...config,
    experiments: process.env.EXPO_PUBLIC_BASE_URL ? { ...experiments, baseUrl: process.env.EXPO_PUBLIC_BASE_URL } : experiments,
  };
};
