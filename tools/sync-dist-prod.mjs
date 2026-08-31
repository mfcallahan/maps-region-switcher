// Copies the built extensions + their zips from dist/ (gitignored, scratch)
// into dist_prod/ (tracked in git), so someone can clone the repo and load
// the extension straight away -- no Node, no npm, no build step -- and so
// the ready-to-upload zips are always sitting in the repo for handing off.
//
// Run via `npm run build` (which builds dist/ first, then calls this) or
// directly via `npm run build:prod`, an alias for the same thing. dist_prod/
// is fully regenerated each time (deleted and rebuilt), so it always
// mirrors the current source -- never hand-edit files in it.
import { cp, rm, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const TARGETS = ["chrome", "firefox"];
const OUT_DIR = "dist_prod";

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

for (const target of TARGETS) {
  await cp(path.join("dist", target), path.join(OUT_DIR, target), {
    recursive: true
  });
}

const distEntries = await readdir("dist");
for (const entry of distEntries) {
  if (entry.endsWith(".zip")) {
    await cp(path.join("dist", entry), path.join(OUT_DIR, entry));
  }
}

console.log(`Synced dist/{chrome,firefox}/ and zips -> ${OUT_DIR}/`);
