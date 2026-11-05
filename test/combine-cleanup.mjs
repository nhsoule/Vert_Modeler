// Combine cut. Run from the repo root:  node test/combine-cleanup.mjs
//   his84.txt  -> the arms are cut where they pass through the bucket and the grip;
//                 those two stay byte-identical, and the result is near 80 triangles.
//   cube_3.txt -> the plank is cut where it passes through the crate. The crate's
//                 108 triangles stay byte-identical, including with Mirror X on.
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixDir = path.join(root, "test", "fixtures");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.__toasts = [];
function dummyEl(id) {
  const el = {
    id,
    className: "",
    value: "",
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {},
    appendChild() { return el; },
    addEventListener() {},
    setAttribute() {},
    remove() {},
    select() {},
    setSelectionRange() {},
    getContext() { return null; },
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(v) { text = String(v); if (id === "toast" && text) globalThis.__toasts.push(text); },
  });
  return el;
}
globalThis.document = {
  getElementById: (id) => dummyEl(id),
  createElement: (tag) => dummyEl(tag),
  querySelectorAll: () => [],
  body: dummyEl("body"),
};

function loadModeler() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const m = html.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no script in index.html");
  const body = m[1];
  const webgl = body.indexOf("//----- WebGL Setup -----||");
  const sel = body.indexOf("//----- Selection -----||");
  const scale = body.indexOf("//----- Scale -----||");
  const exp = body.indexOf("//----- Export -----||");
  const ui = body.indexOf("//----- UI Wiring -----||");
  if (webgl < 0 || sel < 0 || scale < 0 || exp < 0 || ui < 0) throw new Error("section marker missing");
  // Geometry + combine, selection helpers, then the exporter.
  // The WebGL draw loop and the DOM wiring stay out of the test.
  const src = body.slice(0, webgl) + "\n" + body.slice(sel, scale) + "\n" + body.slice(exp, ui) + `
let meshDirty = true;
function updateUI() {}
function $(id) { return document.getElementById(id); }
globalThis.__vertTest = {
  cmdCombine, undo, redo, buildExportPacked, makeObject, makeCube, cutJoined, cutInside, cutWorldTris,
  get scene() { return scene; },
  set scene(v) { scene = v; },
  get mesh() { return mesh; },
  set mesh(v) { mesh = v; },
  get objSel() { return objSel; },
  set objSel(v) { objSel = v; },
  get light() { return light; },
  set bakeOn(v) { bakeOn = v; },
  get bakeOn() { return bakeOn; },
  DEFAULT_PALETTE, POS_Q, triCount, vertCount, setSunFromDir,
};
`;
  vm.runInThisContext(src, { filename: "index.html" });
  return globalThis.__vertTest;
}

function parsePacked(text) {
  const re = /\{\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  const verts = [];
  let m;
  while ((m = re.exec(text))) verts.push(m.slice(1, 9).map(Number));
  const tris = [];
  for (let i = 0; i < verts.length; i += 3) tris.push(verts.slice(i, i + 3));
  return tris;
}

function parseHis(text) {
  const rows = [];
  for (const line of text.split(/\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length >= 8 && /^-?\d+$/.test(p[0])) rows.push(p.slice(0, 8).map(Number));
  }
  return rows;
}

// Weld a triangle soup into connected components (shared positions = one vertex).
function componentsOf(rows) {
  const index = new Map();
  const qpos = [];
  const idx = [];
  for (const r of rows) {
    const key = r[0] + "," + r[1] + "," + r[2];
    if (!index.has(key)) { index.set(key, qpos.length); qpos.push(r.slice(0, 3)); }
    idx.push(index.get(key));
  }
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) tris.push(idx.slice(i, i + 3));
  const n = qpos.length;
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b, c] of tris) {
    adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
  }
  const comp = new Array(n).fill(-1);
  const groups = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = groups.length;
    const g = [];
    while (stack.length) {
      const u = stack.pop();
      g.push(u);
      for (const w of adj[u]) if (comp[w] < 0) { comp[w] = groups.length; stack.push(w); }
    }
    groups.push(g);
  }
  // Tris in file order, grouped by the component of their first appearance.
  const byComp = groups.map(() => []);
  for (const t of tris) byComp[comp[t[0]]].push(t);
  return { qpos, byComp, comp };
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
}

function main() {
  const api = loadModeler();
  const { POS_Q, DEFAULT_PALETTE } = api;
  const grey = DEFAULT_PALETTE[6].slice();

  // ----- nothing intersects: two cubes side by side stay two cubes' worth of faces -----
  globalThis.__toasts.length = 0;
  const cubeA = api.makeCube(null);
  const cubeB = api.makeCube(null);
  const oA = api.makeObject("cubeA", cubeA, [0, 0, 0]);
  const oB = api.makeObject("cubeB", cubeB, [3, 0, 0]);
  const beforeCubes = JSON.parse(JSON.stringify([oA, oB].map(o => ({
    pos: o.pos, positions: o.mesh.positions, tris: o.mesh.tris,
  }))));
  api.scene = { name: "scene", active: 0, objects: [oA, oB] };
  api.mesh = oA.mesh;
  api.objSel = new Set([oA.id, oB.id]);
  api.cmdCombine();
  const cubeToast = globalThis.__toasts.at(-1) || "";
  assert(api.scene.objects.length === 1, "disjoint combine should leave one object");
  assert(api.triCount() === 24, "disjoint cubes should stay 24 tris, got " + api.triCount());
  assert(api.vertCount() === 16, "disjoint cubes should stay 16 verts, got " + api.vertCount());
  assert(!/tucked|dropped/.test(cubeToast), "disjoint combine should not report cleanup: " + cubeToast);
  api.undo();
  assert(api.scene.objects.length === 2, "undo should restore both cubes");
  const afterUndo = api.scene.objects.map(o => ({ pos: o.pos, positions: o.mesh.positions, tris: o.mesh.tris }));
  assert(JSON.stringify(afterUndo) === JSON.stringify(beforeCubes), "undo should restore the cubes exactly");
  console.log("ok  disjoint cubes: 24 tris, no cleanup, undo restores both");

  // Build separate objects from a vertex dump. Returns the objects and per-part
  // triangle keys (quantized positions, winding kept) so a winner can be checked
  // byte-for-byte after the cut.
  function buildParts(rows, offset, scale, names) {
    const { qpos, byComp } = componentsOf(rows);
    const objects = byComp.map((tris, i) => {
      const remap = new Map();
      const positions = [];
      const faces = [];
      for (const t of tris) {
        for (const v of t) {
          if (!remap.has(v)) {
            remap.set(v, positions.length / 3);
            const q = qpos[v];
            positions.push(offset[0] + (q[0] / POS_Q) * scale, offset[1] + (q[1] / POS_Q) * scale, offset[2] + (q[2] / POS_Q) * scale);
          }
          faces.push(remap.get(v));
        }
      }
      const mesh = { positions, tris: faces, colors: Array.from({ length: faces.length / 3 }, () => grey.slice()), partner: [], mirror: null };
      const o = api.makeObject(names[i] || "part", mesh, [0, 0, 0]);
      o._keys = tris.map(t => t.map(v => qpos[v].join(",")).join("|"));
      o._n = tris.length;
      return o;
    });
    return objects;
  }
  function exportKeys() {
    const tris = parsePacked(api.buildExportPacked());
    return tris.map(t => t.map(v => v.slice(0, 3).join(",")).join("|"));
  }
  function keptCount(keys, exported) {
    const bag = new Set(exported);
    return keys.filter(k => bag.has(k)).length;
  }

  // ----- bucket: arms are cut, the body and the grip are not touched -----
  const header = fs.readFileSync(path.join(fixDir, "Bucket80.h"), "utf8");
  const offset = header.match(/_offset\[3\]\s*=\s*\{\s*([^}]+)\}/)[1].split(",").map(s => parseFloat(s));
  const scale = parseFloat(header.match(/_scale\s*=\s*([-+0-9.eE]+)/)[1]);
  const his = parseHis(fs.readFileSync(path.join(fixDir, "his84.txt"), "utf8"));
  const bucketParts = buildParts(his, offset, scale, ["bucket", "grip", "armL", "armR"]);
  assert(bucketParts.map(o => o._n).join(",") === "44,12,14,14", "unexpected his84 part sizes");
  const bodyVol = api.cutWorldTris(bucketParts[0]);
  const gripVol = api.cutWorldTris(bucketParts[1]);
  globalThis.__toasts.length = 0;
  api.scene = { name: "Bucket", active: 0, objects: bucketParts };
  api.mesh = bucketParts[0].mesh;
  api.objSel = new Set(bucketParts.map(o => o.id));
  api.cmdCombine();
  const bucketToast = globalThis.__toasts.at(-1) || "";
  const bucketKeys = exportKeys();
  assert(keptCount(bucketParts[0]._keys, bucketKeys) === 44, "the bucket body must stay byte-identical");
  assert(keptCount(bucketParts[1]._keys, bucketKeys) === 12, "the grip must stay byte-identical");
  assert(api.triCount() >= 80 && api.triCount() <= 100, "arm cut should land near 80 tris, got " + api.triCount());
  assert(/cut armL and armR/.test(bucketToast), "expected the arms to be the parts that are cut: " + bucketToast);
  const P = api.mesh.positions, T = api.mesh.tris;
  const winnerKeys = new Set([...bucketParts[0]._keys, ...bucketParts[1]._keys]);
  let buried = 0;
  for (let t = 0; t < T.length; t += 3) {
    const key = [0, 1, 2].map(k => {
      const i = T[t + k];
      return [0, 1, 2].map(c => Math.round((P[i * 3 + c] - offset[c]) / scale * POS_Q)).join(",");
    }).join("|");
    if (winnerKeys.has(key)) continue;
    const mid = [0, 1, 2].map(k => (P[T[t] * 3 + k] + P[T[t + 1] * 3 + k] + P[T[t + 2] * 3 + k]) / 3);
    if (api.cutInside(mid, bodyVol) || api.cutInside(mid, gripVol)) buried++;
  }
  assert(buried === 0, buried + " triangles are still inside the bucket or the grip");
  api.undo();
  assert(api.scene.objects.length === 4, "undo should restore the 4 bucket parts");
  console.log("ok  his84 combine -> " + bucketKeys.length + " tris, bucket and grip untouched, nothing left inside");

  // ----- crate: only the plank is cut; the crate's 108 triangles stay identical -----
  const crateRows = parseHis(fs.readFileSync(path.join(fixDir, "cube_3.txt"), "utf8"));
  const crateOff = [0.03873622, 0.30441112, 0.03792348];
  const crateSc = 0.91715836;
  const crateParts = buildParts(crateRows, crateOff, crateSc, ["plank", "bucket", "grip", "armL", "armR", "crate"]);
  assert(crateParts[0]._n === 4 && crateParts[5]._n === 108, "cube_3 plank/crate sizes");
  // Mirror X on, the way the phone screenshot had it, and the crate is the active object.
  for (const o of crateParts) o.mesh.mirror = "x";
  const crateVol = api.cutWorldTris(crateParts[5]);
  const ordered = [crateParts[5], crateParts[0], crateParts[1], crateParts[2], crateParts[3], crateParts[4]];
  globalThis.__toasts.length = 0;
  api.scene = { name: "cube_3", active: 0, objects: ordered };
  api.mesh = ordered[0].mesh;
  api.objSel = new Set(ordered.map(o => o.id));
  api.cmdCombine();
  const crateToast = globalThis.__toasts.at(-1) || "";
  const crateKeys = exportKeys();
  assert(keptCount(crateParts[5]._keys, crateKeys) === 108, "crate triangles must stay byte-identical");
  assert(/cut plank/.test(crateToast), "the plank should be what gets cut: " + crateToast);
  assert(!/cut crate/.test(crateToast), "the crate must not be cut: " + crateToast);
  const MP = api.mesh.positions, MT = api.mesh.tris;
  let plankInside = 0;
  for (let t = 0; t < MT.length; t += 3) {
    const mid = [0, 1, 2].map(k => (MP[MT[t] * 3 + k] + MP[MT[t + 1] * 3 + k] + MP[MT[t + 2] * 3 + k]) / 3);
    // Only count a piece that isn't one of the original crate triangles.
    const key = [0, 1, 2].map(k => {
      const i = MT[t + k];
      return [0, 1, 2].map(c => Math.round((MP[i * 3 + c] - crateOff[c]) / crateSc * POS_Q)).join(",");
    }).join("|");
    if (crateParts[5]._keys.includes(key)) continue;
    if (api.cutInside(mid, crateVol)) plankInside++;
  }
  assert(plankInside === 0, plankInside + " non-crate triangles are still inside the crate");
  api.undo();
  assert(api.scene.objects.length === 6, "undo should restore the 6 crate-scene parts");
  api.redo();
  assert(api.triCount() === crateKeys.length, "redo should bring the cut back");
  console.log("ok  cube_3 combine with Mirror X -> " + crateKeys.length + " tris, crate's 108 unchanged, plank cut");

  // The Cut menu: "the active object" cuts only that one; "the other objects" cuts the rest.
  function fresh() {
    return buildParts(crateRows, crateOff, crateSc, ["plank", "bucket", "grip", "armL", "armR", "crate"]);
  }
  const byActive = fresh();
  const cratePos = byActive[5].mesh.positions.slice();
  api.cutJoined([byActive[0], byActive[5]], "active");
  assert(byActive[0].mesh.tris.length > 12, "Cut: the active object should cut the plank");
  assert(byActive[5].mesh.positions.join(",") === cratePos.join(","), "cutting the plank must not move a crate vertex");
  const byOthers = fresh();
  const cratePos2 = byOthers[5].mesh.positions.slice();
  api.cutJoined([byOthers[5], byOthers[0]], "others");
  assert(byOthers[0].mesh.tris.length > 12, "Cut: the other objects should cut the plank");
  assert(byOthers[5].mesh.positions.join(",") === cratePos2.join(","), "the crate stays put when the others are cut");
  const noCut = fresh();
  api.cutJoined([noCut[5], noCut[0]], "active");
  assert(noCut[5].mesh.tris.length === 324 && noCut[0].mesh.tris.length === 12,
    "an open plank is not a volume, so it cannot cut the active crate");
  console.log("ok  Cut choice: active cuts the plank, others cuts the plank, an open shape never cuts");

  if (process.exitCode) process.exit(process.exitCode);
  console.log("all checks passed");
}

main();
