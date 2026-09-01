// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // "set-state-in-effect" flags any setState reachable from a
    // useEffect body — including the standard fetch-on-mount pattern
    // (useEffect -> async load() -> setState) used throughout this
    // codebase's parent web app (src/pages/*.jsx). Adopting Suspense/
    // use() everywhere to satisfy it would be a much bigger, unrelated
    // rewrite, so it's disabled rather than restructured around.
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]);
