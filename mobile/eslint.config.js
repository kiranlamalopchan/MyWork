// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "ios/*", "android/*", "plugins/*"],
  },
  {
    rules: {
      // The React Compiler's rules assume it is on; it is not here, and the
      // patterns they flag (a ref read in render, a shared value or a video
      // player poked in an effect, a lazily required native component) are
      // how reanimated, expo-video and ui/native are meant to be used.
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      // A curly apostrophe in JSX text is fine on a phone.
      "react/no-unescaped-entities": "off",
      // Native modules are required on first use so an old build degrades
      // to a message rather than a blank screen (see ui/native.ts).
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
