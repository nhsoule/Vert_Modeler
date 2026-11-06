// Combine. Run from the repo root:  node test/combine-cleanup.mjs
//   Slide & trim: his84.txt matches Bucket80.h (80 tris).
//   Delete hidden faces: only triangles entirely inside the winner are removed.
//   cube_3.txt: the crate's 108 triangles stay byte-identical in both modes.
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
const allPalettes = () => [{ id: "default", colors: DEFAULT_PALETTE }];
globalThis.__vertTest = {
  cmdCombine, undo, redo, buildExportPacked, makeObject, makeCube, combineJoined, importMesh, parsePacked: parsePacked,
  get combineMode() { return combineMode; },
  set combineMode(v) { combineMode = v; },
  get cutMode() { return cutMode; },
  set cutMode(v) { cutMode = v; },
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
  assert(!/slid|deleted|left /.test(cubeToast), "disjoint combine should not report cleanup: " + cubeToast);
  api.undo();
  assert(api.scene.objects.length === 2, "undo should restore both cubes");
  const afterUndo = api.scene.objects.map(o => ({ pos: o.pos, positions: o.mesh.positions, tris: o.mesh.tris }));
  assert(JSON.stringify(afterUndo) === JSON.stringify(beforeCubes), "undo should restore the cubes exactly");
  console.log("ok  disjoint cubes: 24 tris, no cleanup, undo restores both");

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
  function snap(parts) {
    return parts.map(o => ({
      name: o.name,
      pos: o.mesh.positions.slice(),
      tris: o.mesh.tris.slice(),
    }));
  }

  // ----- Slide & trim: his84 matches the hand-made 80-triangle header -----
  const header = fs.readFileSync(path.join(fixDir, "Bucket80.h"), "utf8");
  const offset = header.match(/_offset\[3\]\s*=\s*\{\s*([^}]+)\}/)[1].split(",").map(s => parseFloat(s));
  const scale = parseFloat(header.match(/_scale\s*=\s*([-+0-9.eE]+)/)[1]);
  const his = parseHis(fs.readFileSync(path.join(fixDir, "his84.txt"), "utf8"));
  assert(his.length === 84 * 3, "his84 should be 84 triangles");
  function bucketScene() {
    const parts = buildParts(his, offset, scale, ["bucket", "grip", "armL", "armR"]);
    api.combineMode = "slide";
    api.cutMode = "auto";
    api.light.preset = "classic";
    api.bakeOn = true;
    api.setSunFromDir([-0.5890, 0, 0.8081]);
    api.scene = { name: "Bucket", active: 0, objects: parts };
    api.mesh = parts[0].mesh;
    api.objSel = new Set(parts.map(o => o.id));
    return parts;
  }
  globalThis.__toasts.length = 0;
  const slideParts = bucketScene();
  const slideBefore = slideParts.reduce((n, o) => n + o._n, 0);
  api.cmdCombine();
  const slideToast = globalThis.__toasts.at(-1) || "";
  const got = parsePacked(api.buildExportPacked());
  const exp = parsePacked(header);
  assert(got.length === 80 && exp.length === 80, "slide mode should export 80 tris, got " + got.length);
  const origPos = new Set(his.map(r => r[0] + "," + r[1] + "," + r[2]));
  let movedFaces = 0;
  for (let i = 0; i < got.length; i++) {
    const g = got[i], e = exp[i];
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++)
        assert(g[k][c] === e[k][c], "tri " + i + " position " + g[k].slice(0, 3) + " != " + e[k].slice(0, 3));
      assert(g[k][3] === e[k][3] && g[k][4] === e[k][4], "tri " + i + " oct normal " + g[k].slice(3, 5) + " != " + e[k].slice(3, 5));
    }
    const moved = g.some(v => !origPos.has(v[0] + "," + v[1] + "," + v[2]));
    if (moved) movedFaces++;
    for (let k = 0; k < 3; k++) for (let c = 5; c < 8; c++) {
      const d = Math.abs(g[k][c] - e[k][c]);
      assert(d <= (moved ? 1 : 0), "tri " + i + " colour channel off by " + d);
    }
  }
  assert(movedFaces === 24, "shortened arm faces should be 24, got " + movedFaces);
  assert(/slid /.test(slideToast) && /deleted /.test(slideToast), "unexpected slide toast: " + slideToast);
  api.undo();
  assert(api.scene.objects.length === 4, "undo should restore the 4 bucket parts");
  assert(api.scene.objects.reduce((n, o) => n + o.mesh.tris.length / 3, 0) === slideBefore, "undo should restore the bucket tris");
  api.redo();
  assert(api.triCount() === 80, "redo should bring the 80-triangle bucket back");
  console.log("ok  slide his84 -> 80 tris match Bucket80.h; " + slideToast);

  // ----- Delete hidden faces on the bucket: winners stay, only fully buried faces go -----
  globalThis.__toasts.length = 0;
  const delParts = bucketScene();
  api.combineMode = "delete";
  const bodyKeys = delParts[0]._keys.slice();
  const gripKeys = delParts[1]._keys.slice();
  api.cmdCombine();
  const delToast = globalThis.__toasts.at(-1) || "";
  const delKeys = exportKeys();
  assert(keptCount(bodyKeys, delKeys) === 44, "delete mode must leave the bucket body byte-identical");
  assert(keptCount(gripKeys, delKeys) === 12, "delete mode must leave the grip byte-identical");
  assert(!/slid /.test(delToast), "delete mode must not slide: " + delToast);
  api.undo();
  assert(api.scene.objects.length === 4, "undo should restore the bucket parts after delete mode");
  console.log("ok  delete his84 -> " + delKeys.length + " tris; " + delToast);

  // ----- crate, both modes, including Mirror X -----
  const crateRows = parseHis(fs.readFileSync(path.join(fixDir, "cube_3.txt"), "utf8"));
  const crateOff = [0.03873622, 0.30441112, 0.03792348];
  const crateSc = 0.91715836;
  const notch = ["-2822,-25697,-8794", "-2822,-3936,13257", "-2822,-22434,-13067", "-2822,625,10298"];
  function crateScene(mirror) {
    const parts = buildParts(crateRows, crateOff, crateSc, ["plank", "bucket", "grip", "armL", "armR", "crate"]);
    if (mirror) for (const o of parts) o.mesh.mirror = "x";
    const ordered = [parts[5], parts[0], parts[1], parts[2], parts[3], parts[4]];
    api.cutMode = "auto";
    api.scene = { name: "cube_3", active: 0, objects: ordered };
    api.mesh = ordered[0].mesh;
    api.objSel = new Set(ordered.map(o => o.id));
    return { parts, ordered };
  }
  function runCrate(how, mirror) {
    globalThis.__toasts.length = 0;
    api.combineMode = how;
    const { parts } = crateScene(mirror);
    const plankPos = parts[0].mesh.positions.slice();
    api.cmdCombine();
    const toast = globalThis.__toasts.at(-1) || "";
    const keys = exportKeys();
    assert(keptCount(parts[5]._keys, keys) === 108, how + (mirror ? " mirror" : "") + " must keep the crate's 108 triangles");
    assert(!/on crate/.test(toast), "the crate must not be the shape that changes: " + toast);
    return { toast, keys, plankPos, n: keys.length };
  }

  const slideCrate = runCrate("slide", false);
  const slideExport = parsePacked(api.buildExportPacked());
  const have = new Set(slideExport.flat().map(v => v.slice(0, 3).join(",")));
  for (const p of notch) assert(!have.has(p), "slide mode must not notch the plank onto " + p);
  api.undo();
  assert(api.scene.objects.length === 6, "undo should restore the 6 crate parts");
  api.redo();
  assert(api.triCount() === slideCrate.n, "redo should restore the slide-mode crate");
  console.log("ok  slide cube_3 -> " + slideCrate.n + " tris; " + slideCrate.toast);

  const slideMirror = runCrate("slide", true);
  assert(slideMirror.n === slideCrate.n, "Mirror X should not change the slide-mode triangle count");
  api.undo();
  assert(api.scene.objects.length === 6, "undo should restore the mirrored crate scene");
  console.log("ok  slide cube_3 with Mirror X -> " + slideMirror.n + " tris; " + slideMirror.toast);

  const delCrate = runCrate("delete", false);
  const delExport = parsePacked(api.buildExportPacked());
  // Nothing may move: every exported position is one of the original quantized positions.
  const crateOrig = new Set(crateRows.map(r => r.slice(0, 3).join(",")));
  for (const t of delExport) for (const v of t)
    assert(crateOrig.has(v.slice(0, 3).join(",")), "delete mode moved a vertex to " + v.slice(0, 3));
  api.undo();
  api.redo();
  assert(api.triCount() === delCrate.n, "redo should restore delete mode");
  console.log("ok  delete cube_3 -> " + delCrate.n + " tris; " + delCrate.toast);

  const delMirror = runCrate("delete", true);
  assert(delMirror.n === delCrate.n, "Mirror X should not change the delete-mode triangle count");
  console.log("ok  delete cube_3 with Mirror X -> " + delMirror.n + " tris; " + delMirror.toast);

  // Import builds the same two meshes the Import button does, then Combine.
  function headerFromTris(name, tris, qpos) {
    const lines = [];
    for (const t of tris) for (const v of t) {
      const q = qpos[v];
      lines.push(`  { { ${q[0]}, ${q[1]}, ${q[2]} }, { 0, 0 }, { 180, 180, 190, 255 } },`);
    }
    return `#pragma once\n#include "vert.h"\n// lighting baked into colors (0.55 + 0.45*max(0, n.(0.3,0.5,0.8)))\nstatic const float ${name}_offset[3] = { 0.03873622f, 0.30441112f, 0.03792348f };\nstatic const float ${name}_scale = 0.91715836f;\nstatic const Vert ${name}_verts[] = {\n${lines.join("\n")}\n};\n`;
  }
  const comp = componentsOf(crateRows);
  for (const how of ["slide", "delete"]) {
    const objs = ["crate", "plank"].map((name, i) => {
      const part = i === 0 ? comp.byComp[5] : comp.byComp[0];
      const parsed = api.parsePacked(headerFromTris(name, part, comp.qpos));
      const res = api.importMesh(parsed.nums, null, parsed.lighting, parsed.sun, parsed.stride, { bake: parsed.bake, packed: true });
      return api.makeObject(name, res.mesh, [0, 0, 0]);
    });
    api.combineMode = how;
    api.cutMode = "auto";
    api.scene = { name: "imported", active: 0, objects: objs };
    api.mesh = objs[0].mesh;
    api.objSel = new Set(objs.map(o => o.id));
    globalThis.__toasts.length = 0;
    api.cmdCombine();
    const toast = globalThis.__toasts.at(-1) || "";
    // Crate 108 + plank 4 = 112. Slide drops the 2 thin edges; delete drops nothing.
    const expect = how === "slide" ? 110 : 112;
    assert(api.triCount() === expect, "imported " + how + " should be " + expect + " tris, got " + api.triCount() + " (" + toast + ")");
    assert(!/on crate/.test(toast), "imported " + how + " must not change the crate: " + toast);
    console.log("ok  imported crate+plank " + how + " -> " + api.triCount() + " tris; " + toast);
  }

  if (process.exitCode) process.exit(process.exitCode);
  console.log("all checks passed");
}

main();
