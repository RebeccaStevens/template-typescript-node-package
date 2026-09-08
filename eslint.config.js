// @ts-check
import rsEslint from "@rebeccastevens/eslint-config";

export default rsEslint({
  projectRoot: import.meta.dirname,
  ignores: ["scripts/init.js"],
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
});
