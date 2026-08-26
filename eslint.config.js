// @ts-check
import rsEslint from "@rebeccastevens/eslint-config";

export default rsEslint(
  {
    projectRoot: import.meta.dirname,
    ignores: ["scripts/init.js", "CALIBRATION.md"],
    mode: "library",
    typescript: {
      unsafe: "off",
    },
    formatters: true,
    functional: "recommended",
    json: true,
    markdown: true,
    stylistic: true,
    yaml: true,
    command: true,
    security: true,
    pnpm: true,
  },
  {
    files: ["scripts/init.ts"],
    rules: {
      "node/hashbang": "off",
      "security/detect-non-literal-regexp": "off",
      "sonar/super-linear-regex": "off",
      "unicorn/no-negated-array-predicate": "off",
      "unicorn/no-unsafe-string-replacement": "off",
      "unicorn/prefer-https": "off",
    },
  },
  {
    files: ["**/*.config.?([cm])[jt]s", "eslint.config.js", "tests/**"],
    rules: {
      "node/no-unpublished-import": "off",
    },
  },
);
