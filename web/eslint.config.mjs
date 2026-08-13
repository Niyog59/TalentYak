import { defineConfig, globalIgnores } from "eslint/config";
import { flatConfig } from "eslint-config-next";

const eslintConfig = defineConfig([
  ...flatConfig.coreWebVitals,
  ...flatConfig.typescript,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
