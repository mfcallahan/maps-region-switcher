// Assembles the per-browser dist/ folders from the shared src/ tree, then
// zips each into dist/maps-region-switcher-<version>-<target>.zip.
//
// src/ is genuinely identical for both targets (background.js picks
// `browser` vs `chrome` at runtime -- see the shim at the top of
// background.js and popup.js), so the only thing that differs between
// builds is which manifests/manifest.<target>.json gets copied in as
// manifest.json. version is read from package.json rather than kept in
// each manifest, so there is exactly one place that needs bumping.
//
// The zip step shells out to the system `zip` binary with COPYFILE_DISABLE=1
// and `-X` (strip extra file attributes) rather than a bundled zip library,
// specifically to avoid macOS embedding __MACOSX/._* AppleDouble
// resource-fork sidecar files in the archive -- AMO's linter flags those as
// "Hidden file" warnings, and plain `zip` (or Finder's "Compress") includes
// them by default on macOS whenever a source file carries extended
// attributes (quarantine flag, Finder tags, etc).
//
// Usage: node tools/build.mjs [chrome|firefox|all]   (default: all)
import { readFile, writeFile, cp, rm, mkdir } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TARGETS = ["chrome", "firefox"];
const requested = process.argv[2] ?? "all";
const targets = requested === "all" ? TARGETS : [requested];

if (!targets.every((t) => TARGETS.includes(t))) {
  console.error(`Unknown target "${requested}". Use: ${TARGETS.join(", ")}, or "all".`);
  process.exit(1);
}

const { version } = JSON.parse(await readFile("package.json", "utf8"));

function zipTarget(target) {
  const zipName = `maps-region-switcher-${version}-${target}.zip`;
  const zipPath = path.join("dist", zipName);
  rmSyncQuiet(zipPath);

  const result = spawnSync(
    "zip",
    ["-r", "-X", path.join("..", zipName), ".", "-x", ".*"],
    {
      cwd: path.join("dist", target),
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (result.error || result.status !== 0) {
    console.warn(
      `Warning: could not zip dist/${target}/ (is "zip" installed?). ` +
      `Skipping archive; dist/${target}/ is still built.`
    );
    if (result.stderr && result.stderr.length) {
      console.warn(result.stderr.toString());
    }
    return;
  }
  console.log(`Zipped dist/${zipName}`);
}

function rmSyncQuiet(p) {
  try {
    rmSync(p, { force: true });
  } catch {
    // ignore
  }
}

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

  zipTarget(target);
}
