import fs from "node:fs/promises";

const [, , nextVersion] = process.argv;

if (!nextVersion || !/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  console.error("Usage: node version-bump.mjs <x.y.z>");
  process.exit(1);
}

const manifest = JSON.parse(await fs.readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await fs.readFile(new URL("./package.json", import.meta.url), "utf8"));
const versions = JSON.parse(await fs.readFile(new URL("./versions.json", import.meta.url), "utf8"));

manifest.version = nextVersion;
packageJson.version = nextVersion;
versions[nextVersion] = manifest.minAppVersion;

await fs.writeFile(new URL("./manifest.json", import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(new URL("./package.json", import.meta.url), `${JSON.stringify(packageJson, null, 2)}\n`);
await fs.writeFile(new URL("./versions.json", import.meta.url), `${JSON.stringify(versions, null, 2)}\n`);

console.log(JSON.stringify({
  version: nextVersion,
  minAppVersion: manifest.minAppVersion
}, null, 2));
