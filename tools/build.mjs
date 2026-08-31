// Assembles the per-browser dist/ folders from the shared src/ tree.
//
// src/ is genuinely identical for both targets (background.js picks
// `browser` vs `chrome` at runtime -- see the shim at the top of
// background.js and popup.js), so the only thing that differs between
// builds is which manifests/manifest.<target>.json gets copied in as
// manifest.json. version is read from package.json rather than kept in
// each manifest, so there is exactly one place that needs bumping.
//
// Usage: node tools/build.mjs [chrome|firefox|all]   (default: all)
import { readFile, writeFile, cp, rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGETS = ["chrome", "firefox"];
const requested = process.argv[2] ?? "all";
const targets = requested === "all" ? TARGETS : [requested];

if (!targets.every((t) => TARGETS.includes(t))) {
  console.error(`Unknown target "${requested}". Use: ${TARGETS.join(", ")}, or "all".`);
  process.exit(1);
}

const { version } = JSON.parse(await readFile("package.json", "utf8"));

for (const target of targets) {
  const outDir = path.join("dist", target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp("src", outDir, { recursive: true });

  const manifest = JSON.parse(
    await readFile(path.join("manifests", `manifest.${target}.json`), "utf8")
  );
  manifest.version = version;
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  console.log(`Built dist/${target}/ (v${version})`);
}
