// Edge density: unique edges, in the world units the export recovers
// (world = offset + (pos/32767) * scale). Run from the repo root:
//   node test/edge-density.mjs
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
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
    set(v) { text = String(v); },
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
  const src = body.slice(0, webgl) + "\n" + body.slice(sel, scale) + "\n" + body.slice(exp, ui) + `
let meshDirty = true;
function updateUI() {}
function $(id) { return document.getElementById(id); }
globalThis.__vertTest = {
  edgeDensity, modelFrame, quantizePos, dequantizePos, getVert, makeCube, makeObject,
  buildExportPacked, POS_Q,
  get mesh() { return mesh; },
  set mesh(v) { mesh = v; },
  get scene() { return scene; },
  set scene(v) { scene = v; },
};
`;
  vm.runInThisContext(src, { filename: "index.html" });
  return globalThis.__vertTest;
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function useMesh(api, m) {
  const o = api.makeObject("model", m, [0, 0, 0], false);
  api.scene = { name: "scene", active: 0, objects: [o] };
  api.mesh = m;
}

// Length the export will store: distance between recovered world positions.
function worldLen(api, a, b) {
  const frame = api.modelFrame();
  const pa = api.dequantizePos(api.quantizePos(api.getVert(a), frame), frame);
  const pb = api.dequantizePos(api.quantizePos(api.getVert(b), frame), frame);
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

// Independent unique-edge walk, so a double-counted shared edge fails the count.
function manual(api) {
  const seen = new Set(), lens = [];
  const T = api.mesh.tris;
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      let a = T[t + k], b = T[t + (k + 1) % 3];
      if (a > b) [a, b] = [b, a];
      const key = a + "," + b;
      if (seen.has(key)) continue;
      seen.add(key);
      lens.push(worldLen(api, a, b));
    }
  }
  let sum = 0, min = lens[0], max = lens[0];
  for (const L of lens) { sum += L; if (L < min) min = L; if (L > max) max = L; }
  return { n: lens.length, avg: sum / lens.length, min, max };
}

function assertSpread(got, exp, label) {
  assert(got && got.n === exp.n, label + " edge count " + (got && got.n) + " != " + exp.n);
  assert(near(got.avg, exp.avg), label + " avg " + got.avg + " != " + exp.avg);
  assert(near(got.min, exp.min), label + " min " + got.min + " != " + exp.min);
  assert(near(got.max, exp.max), label + " max " + got.max + " != " + exp.max);
}

function main() {
  const api = loadModeler();

  // ----- unit cube: 12 sides + 6 face diagonals = 18 unique edges, not 36 corners -----
  useMesh(api, api.makeCube(null));
  const cube = api.edgeDensity(null);
  const cubeAvg = (12 + 6 * Math.SQRT2) / 18;
  assertSpread(cube.model, manual(api), "cube");
  assert(cube.model.n === 18, "a cube mesh has 18 unique edges (12 sides + 6 diagonals), got " + cube.model.n);
  assert(near(cube.model.min, 1) && near(cube.model.max, Math.SQRT2) && near(cube.model.avg, cubeAvg),
    "cube edges should be 1 and √2, got " + JSON.stringify(cube.model));
  assert(cube.marks.length === 0, "a uniform cube has no outlier edges");
  assert(cube.sel === null, "no selection set means no selection spread");
  console.log("ok  unit cube: 18 unique edges, min 1, max √2, no marks");

  // ----- scale and offset: twice as big reads twice as long; a shift does not -----
  // Without * scale, both cubes would report the same normalized length.
  const big = api.makeCube(null);
  for (let i = 0; i < big.positions.length; i++) big.positions[i] *= 2;
  useMesh(api, big);
  const bigD = api.edgeDensity(null);
  assertSpread(bigD.model, manual(api), "doubled");
  assert(bigD.model.n === 18 && near(bigD.model.min, 2) && near(bigD.model.max, 2 * Math.SQRT2) && near(bigD.model.avg, 2 * cubeAvg),
    "doubled cube should be twice as long, got " + JSON.stringify(bigD.model));
  assert(near(api.modelFrame().scale, 1), "doubled cube scale (half the longest side) should be 1");
  console.log("ok  doubled cube: min 2 (scale applied, not the normalized -1..1 length)");

  const shifted = api.makeCube(null);
  for (let i = 0; i < shifted.positions.length; i += 3) shifted.positions[i] += 10;
  useMesh(api, shifted);
  const sh = api.edgeDensity(null);
  assert(near(sh.model.avg, cubeAvg) && near(sh.model.min, 1) && near(sh.model.max, Math.SQRT2),
    "a translated cube keeps its edge lengths, got " + JSON.stringify(sh.model));
  assert(near(api.modelFrame().offset[0], 10), "translation should move the export offset");
  console.log("ok  translated cube: offset moves, edge lengths stay the same");

  // ----- off the 16-bit grid: the readout matches the recovered export length -----
  // Nudge one corner inward by less than half a grid step. Other corners still
  // hold the bounds, so scale and offset stay put and the nudge rounds away.
  const nudged = api.makeCube(null);
  useMesh(api, nudged);
  const step = api.modelFrame().scale / api.POS_Q;
  nudged.positions[3] -= 0.4 * step;
  const raw = Math.abs(api.mesh.positions[3] - api.mesh.positions[0]);
  const recovered = worldLen(api, 0, 1);
  assert(Math.abs(recovered - raw) > step * 0.2, "export recovery should snap the nudged edge off the raw length");
  assert(near(recovered, 1), "the snap should put that edge back on 1, got " + recovered);
  assertSpread(api.edgeDensity(null).model, manual(api), "nudged");
  console.log("ok  off-grid edge: readout uses recovered length " + recovered.toFixed(6) + ", not raw " + raw.toFixed(8));

  // ----- selection: edges with both ends selected; a gap is not an edge -----
  useMesh(api, api.makeCube(null));
  const face = api.edgeDensity(new Set([0, 1, 4, 5]));
  assert(face.sel && face.sel.n === 5, "a cube face (2 tris) has 5 unique edges, got " + (face.sel && face.sel.n));
  assert(near(face.sel.min, 1) && near(face.sel.max, Math.SQRT2),
    "face edges should be 1 and the diagonal √2, got " + JSON.stringify(face.sel));
  assert(near(face.model.min, 1) && face.model.n === 18, "the model line stays the whole cube");
  const gap = api.edgeDensity(new Set([0, 6]));
  assert(gap.sel === null, "two vertices with no shared edge have no selection spread");
  console.log("ok  selection: 5 face edges (min 1, max √2); unconnected verts are sel —");

  // ----- a short edge is marked against the model average; a normal edge is not -----
  const odd = api.makeCube(null);
  odd.positions[3] = -0.4; odd.positions[4] = -0.5; odd.positions[5] = 0;   // vert 1 next to vert 0
  useMesh(api, odd);
  const oddD = api.edgeDensity(new Set([0, 1]));
  assertSpread(oddD.model, manual(api), "short");
  assert(oddD.sel && oddD.sel.n === 1 && near(oddD.sel.avg, worldLen(api, 0, 1)),
    "the selected edge should be that one short edge");
  assert(oddD.sel.avg < oddD.model.avg * 0.5, "the short edge is under half the average");
  const has = (pair) => oddD.marks.some(([a, b]) => a === pair[0] && b === pair[1]);
  assert(has([0, 1]), "the short edge should be marked");
  assert(!has([2, 3]), "a full-length edge should not be marked");
  console.log("ok  short edge " + oddD.sel.avg.toFixed(4) + " is marked; edge 2–3 is not (avg " + oddD.model.avg.toFixed(4) + ")");

  // ----- reading density does not change the mesh or the export -----
  useMesh(api, api.makeCube(null));
  const before = api.buildExportPacked();
  const pos = api.mesh.positions.slice();
  const tris = api.mesh.tris.slice();
  api.edgeDensity(new Set([0, 1, 2, 4]));
  assert(api.mesh.positions.join(",") === pos.join(","), "edgeDensity should not move vertices");
  assert(api.mesh.tris.join(",") === tris.join(","), "edgeDensity should not change triangles");
  assert(api.buildExportPacked() === before, "edgeDensity should not change the export");
  console.log("ok  readout does not change the mesh or the export");

  if (process.exitCode) process.exit(process.exitCode);
  console.log("all checks passed");
}

main();
