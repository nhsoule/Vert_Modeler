// One-sided plane export, and deleting faces.
// Run from the repo root:
//   node test/plane-face-delete.mjs
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
  makeCube, makePlane, makeObject, buildExportPacked, deleteFaces, cmdDeleteFaces,
  pushUndo, undo, triCount,
  get mesh() { return mesh; },
  set mesh(v) { mesh = v; },
  get scene() { return scene; },
  set scene(v) { scene = v; },
  get faceSel() { return faceSel; },
};
`;
  vm.runInThisContext(src, { filename: "index.html" });
  return globalThis.__vertTest;
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
}

function useMesh(api, m) {
  const o = api.makeObject("model", m, [0, 0, 0], false);
  api.scene = { name: "scene", active: 0, objects: [o] };
  api.mesh = m;
  return o;
}

// Unit normal of triangle t. +Z means the face points up.
function triNormalZ(m, t) {
  const P = m.positions, T = m.tris;
  const at = (k) => {
    const i = T[t * 3 + k] * 3;
    return [P[i], P[i + 1], P[i + 2]];
  };
  const a = at(0), b = at(1), c = at(2);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return n.map(v => v / len);
}

function exportTriCount(src) {
  const line = src.split("\n").find(s => /triangles/.test(s));
  const m = line && line.match(/(\d+) triangles, (\d+) verts/);
  if (!m) throw new Error("no triangle count in export:\n" + src.slice(0, 400));
  return { tris: +m[1], verts: +m[2], lines: (src.match(/\{ \{/g) || []).length };
}

function main() {
  const api = loadModeler();

  // ----- one-sided plane: export is the top faces only -----
  const plane = api.makePlane("flat");
  const o = api.makeObject("plane", plane, [0, 0, 0], false);
  o.twoSided = false;
  api.scene = { name: "scene", active: 0, objects: [o] };
  api.mesh = plane;
  const front = plane.tris.length / 3;
  for (let t = 0; t < front; t++) {
    const n = triNormalZ(plane, t);
    assert(n[2] > 0.9 && Math.abs(n[0]) < 1e-6 && Math.abs(n[1]) < 1e-6, "plane normal should be +Z, got " + n);
  }
  assert(plane.positions.every((v, i) => i % 3 !== 2 || v === 0), "one-sided plane should lie on z = 0");
  const src = api.buildExportPacked(o);
  const exp = exportTriCount(src);
  assert(!o.twoSided, "one-sided plane keeps twoSided false");
  assert(!/two-sided:/.test(src), "export should not add a reversed back-face half");
  assert(exp.tris === front && exp.verts === front * 3 && exp.lines === front * 3,
    "export tri count " + exp.tris + " (verts " + exp.verts + ", lines " + exp.lines + ") != front " + front);
  console.log("one-sided plane: front tris " + front + ", export tris " + exp.tris + ", export verts " + exp.verts);

  // ----- delete 2 faces of a cube: 12 -> 10, undo restores 12 -----
  useMesh(api, api.makeCube(null));
  assert(api.triCount() === 12, "cube starts at 12 tris, got " + api.triCount());
  api.faceSel.clear();
  api.faceSel.add(0);
  api.faceSel.add(1);
  api.cmdDeleteFaces();
  const after = api.triCount();
  assert(after === 10, "deleting 2 faces should leave 10 tris, got " + after);
  api.undo();
  const back = api.triCount();
  assert(back === 12, "undo should restore 12 tris, got " + back);
  console.log("cube face delete: 12 -> " + after + ", undo -> " + back);

  // ----- unused vertices are dropped -----
  const loose = {
    positions: [0, 0, 0,  1, 0, 0,  0, 1, 0,   2, 0, 0,  3, 0, 0,  2, 1, 0],
    tris: [0, 1, 2,  3, 4, 5],
    colors: [[1, 0, 0], [0, 1, 0]],
    partner: [-1, -1, -1, -1, -1, -1],
    mirror: null,
  };
  useMesh(api, loose);
  api.faceSel.clear();
  api.faceSel.add(0);
  api.cmdDeleteFaces();
  assert(api.triCount() === 1, "one of two separate tris should remain, got " + api.triCount());
  assert(api.mesh.positions.length / 3 === 3, "the deleted tri's vertices should be dropped, got " + (api.mesh.positions.length / 3));
  api.undo();
  assert(api.triCount() === 2 && api.mesh.positions.length / 3 === 6, "undo should restore both tris and all 6 verts");
  console.log("unused verts: 6 -> 3 after deleting one separate tri, undo restores 6");
}

main();
