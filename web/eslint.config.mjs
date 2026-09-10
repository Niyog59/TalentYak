import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";

// eslint-config-next ships its flat config as the default export — an array
// of the "next" and "next/typescript" configs. There is no named export.
const eslintConfig = defineConfig([
  ...next,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
