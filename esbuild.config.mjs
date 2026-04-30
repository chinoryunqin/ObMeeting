import esbuild from "esbuild";
import process from "process";

const production = process.argv.includes("production");

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "https",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr"
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
};

if (production) {
  await esbuild.build(buildOptions);
} else {
  const context = await esbuild.context(buildOptions);
  await context.watch();
}
