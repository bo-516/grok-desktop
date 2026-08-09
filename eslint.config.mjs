/**
 * Monorepo ESLint flat config (ESLint 9).
 * Aligns with AGENTS.md: no eslint-disable, file size caps, TS + React hooks.
 */

import eslint from "@eslint/js";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Product hard constraint: files over 440 lines must be split (blank lines and comments skipped). */
const MAX_LINES = 440;

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.vite/**",
      "**/.npm-cache/**",
      "demo/**",
      "docs/**",
      "scripts/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.cjs",
      "*.config.ts",
    ],
  },

  // ── Base JS recommended ─────────────────────────────────────────
  eslint.configs.recommended,

  // ── TypeScript (all packages / apps) ────────────────────────────
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      // ── AGENTS.md: forbid eslint-disable bypass ───────────────────
      "@eslint-community/eslint-comments/no-use": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: false },
      ],

      // ── File size (hard cap 440) ─────────────────────────────────
      "max-lines": [
        "error",
        {
          max: MAX_LINES,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // ── Code style / quality ────────────────────────────────────
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",
      "no-throw-literal": "error",
      "no-nested-ternary": "error",
      "no-else-return": ["error", { allowElseIf: false }],
      curly: ["error", "all"],
      "default-case-last": "error",
      "no-useless-return": "error",
      "no-useless-rename": "error",
      "prefer-arrow-callback": ["error", { allowNamedFunctions: false }],

      // ── TypeScript ──────────────────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // inline type avoids conflict with no-duplicate-imports (type + value on one line)
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-require-imports": "error",

      // Turn off base rules that duplicate prefer-const / no-unused-vars
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "error",
    },
  },

  // ── Node apps (bridge / m0 / acp-core) ──────────────────────────
  {
    files: [
      "apps/bridge/**/*.{ts,tsx}",
      "apps/m0/**/*.{ts,tsx}",
      "packages/acp-core/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // CLI / server may use console
      "no-console": "off",
    },
  },

  // ── React (desktop UI) ──────────────────────────────────────────
  {
    files: ["apps/desktop/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,

      // React 19 + jsx-runtime; no React import needed
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "error",
      "react/jsx-key": "error",
      "react/no-array-index-key": "warn",
      "react/self-closing-comp": "error",
      "react/jsx-curly-brace-presence": [
        "error",
        { props: "never", children: "never" },
      ],
      "react/jsx-boolean-value": ["error", "never"],
      "react/jsx-no-useless-fragment": "error",
      "react/no-unstable-nested-components": "error",

      // UI layer still restricts console (warn/error allowed)
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // ── Tests: slightly relaxed ─────────────────────────────────────
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    languageOptions: {
      // node:test / assert / fs even under apps/desktop (browser UI package)
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "max-lines": "off",
    },
  },

  // ── src/ 内禁止出现测试文件（结构守卫）────────────────────
  {
    files: [
      "apps/*/src/**/*.{test,spec}.{ts,tsx}",
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "Test files must live under the workspace `test/` directory, not `src/`.",
        },
      ],
    },
  },

  // ── 产品代码禁止 import 测试目录 ─────────────────────────
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/test/**", "**/*.test", "**/*.test.*"] },
      ],
    },
  },
);
