import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import prettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"

export default defineConfig([
  { ignores: ["dist/**", "node_modules/**", "experiment/**"] },
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
  },
])
