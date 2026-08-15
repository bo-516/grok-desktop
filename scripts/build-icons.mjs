// Rasterize apps/shell/icons/appicon.svg into the platform icon containers
// committed next to it: icon.icns (macOS bundle) and icon.ico (Windows .exe
// resource, embedded via go-winres — see scripts/build-release.sh).
//
//   npm i --no-save sharp png-to-ico && node scripts/build-icons.mjs
//
// Regenerate only when appicon.svg changes; the outputs are checked in so a
// plain `bash scripts/build-release.sh` needs no image toolchain.
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const ICONS = new URL("../apps/shell/icons/", import.meta.url).pathname;
const SRC = ICONS + "appicon.svg";

const render = (size, file) =>
  sharp(SRC, { density: 400 }).resize(size, size).png().toFile(file);

// macOS: iconutil wants an .iconset directory of exact @1x/@2x pairs.
const work = await mkdtemp(join(tmpdir(), "grok-icons-"));
const iconset = join(work, "GrokDesktop.iconset");
await mkdir(iconset, { recursive: true });
for (const [size, name] of [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
]) {
  await render(size, join(iconset, name));
}
await run("iconutil", ["-c", "icns", iconset, "-o", ICONS + "icon.icns"]);

// Windows: PNG-compressed .ico entries, 16 through 256.
const bufs = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  const file = join(work, `ico-${size}.png`);
  await render(size, file);
  bufs.push(await readFile(file));
}
await writeFile(ICONS + "icon.ico", await pngToIco(bufs));

await rm(work, { recursive: true, force: true });
console.log("wrote icon.icns + icon.ico → apps/shell/icons/");
