import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": ["warn", { "functions": false, "classes": false, "variables": true }],
      "no-console": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "out/", ".next/", "target/", "**/*.js", "**/*.mjs"],
  },
];
