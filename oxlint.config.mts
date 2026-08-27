import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    "node_modules/**",
    "archive/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "**/*.generated.*",
    "**/*.gen.*",
    "**/*.archive.*",
    "**/*.archived.*",
    "**/*.map",
  ],
  rules: {
    complexity: ["error", { max: 20, variant: "classic" }],
  },
});
