import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "public/**", "supabase/**", "src/imports/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Catch real bugs — not style nits
      "no-undef": "off", // TypeScript handles this
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // too noisy for existing codebase
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-constant-condition": "warn",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-empty-pattern": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unused-labels": "error",
      "no-useless-catch": "warn",
      "no-self-assign": "error",
      "no-dupe-keys": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "prefer-const": "off",
      "no-case-declarations": "off",
      "no-prototype-builtins": "off",
      "no-fallthrough": "warn",
      "no-redeclare": "error",
    },
  },
];
