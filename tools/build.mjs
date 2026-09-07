import { readFile, writeFile, cp, rm, mkdir } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TARGETS = ["chrome", "firefox", "edge"];
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
  }
}

for (const target of targets) {
  const manifestPath = path.join("manifests", `manifest.${target}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(manifestPath, manifestJson);

  const outDir = path.join("dist", target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp("src", outDir, { recursive: true });
  await writeFile(path.join(outDir, "manifest.json"), manifestJson);
  console.log(`Built dist/${target}/ (v${version})`);

  zipTarget(target);
}
