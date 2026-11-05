// Combine cleanup. Run from the repo root:  node test/combine-cleanup.mjs
//   his84.txt  -> Bucket80.h (84 tris, arm caps dropped, ends on the rim and grip)
//   cube_3.txt -> plank on a recessed crate: 2 thin edges dropped, board corners
//                 pulled onto the panel opening, crate unchanged (192 -> 190)
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
  cmdCombine, undo, buildExportPacked, makeObject, makeCube, buryJoined,
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

  // ----- reference: his84 parts combined vs Bucket80.h -----
  const header = fs.readFileSync(path.join(fixDir, "Bucket80.h"), "utf8");
  const offM = header.match(/_offset\[3\]\s*=\s*\{\s*([^}]+)\}/);
  const scM = header.match(/_scale\s*=\s*([-+0-9.eE]+)/);
  const offset = offM[1].split(",").map(s => parseFloat(s));
  const scale = parseFloat(scM[1]);
  const rows = parseHis(fs.readFileSync(path.join(fixDir, "his84.txt"), "utf8"));
  assert(rows.length === 84 * 3, "his84 should be 84 triangles, got " + (rows.length / 3));
  const { qpos, byComp } = componentsOf(rows);
  assert(byComp.length === 4, "his84 should be 4 parts, got " + byComp.length);
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
    const names = ["bucket", "grip", "armL", "armR"];
    return api.makeObject(names[i] || "part", mesh, [0, 0, 0]);
  });
  globalThis.__toasts.length = 0;
  api.light.preset = "classic";
  api.bakeOn = true;
  api.setSunFromDir([-0.5890, 0, 0.8081]);
  api.scene = { name: "Bucket", active: 0, objects };
  api.mesh = objects[0].mesh;
  api.objSel = new Set(objects.map(o => o.id));
  const trisBefore = objects.reduce((n, o) => n + o.mesh.tris.length / 3, 0);
  api.cmdCombine();
  const toast = globalThis.__toasts.at(-1) || "";
  assert(api.scene.objects.length === 1, "combine should leave one object");
  assert(api.triCount() === 80, "expected 80 tris after cleanup, got " + api.triCount());
  assert(/tucked 12 verts, dropped 4 hidden faces/.test(toast), "unexpected toast: " + toast);
  const exported = api.buildExportPacked();
  assert(/0\.55 \+ 0\.45\*max\(0, n\.\(-0\.5890,0\.0000,0\.8081\)\)/.test(exported),
    "export should bake with the classic formula and this sun");
  const got = parsePacked(exported);
  const exp = parsePacked(header);
  assert(got.length === 80 && exp.length === 80, "export and Bucket80 should both be 80 tris");
  const origPos = new Set(rows.map(r => r[0] + "," + r[1] + "," + r[2]));
  let movedFaces = 0;
  for (let i = 0; i < got.length; i++) {
    const g = got[i], e = exp[i];
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++)
        assert(g[k][c] === e[k][c], "tri " + i + " position " + g[k].slice(0, 3) + " != " + e[k].slice(0, 3));
      assert(g[k][3] === e[k][3] && g[k][4] === e[k][4], "tri " + i + " oct normal " + g[k].slice(3, 5) + " != " + e[k].slice(3, 5));
    }
    // A face that still uses only the input positions did not move, so its bake must
    // match the hand-made file exactly. A shortened face is re-baked by the exporter;
    // that rounds within 1 byte of the hand-made colour.
    const moved = g.some(v => !origPos.has(v[0] + "," + v[1] + "," + v[2]));
    if (moved) movedFaces++;
    for (let k = 0; k < 3; k++) for (let c = 5; c < 8; c++) {
      const d = Math.abs(g[k][c] - e[k][c]);
      assert(d <= (moved ? 1 : 0), "tri " + i + " colour channel off by " + d);
    }
  }
  assert(movedFaces === 24, "the two arms' remaining faces should be the ones that shortened, got " + movedFaces);
  api.undo();
  const restored = api.scene.objects.reduce((n, o) => n + o.mesh.tris.length / 3, 0);
  assert(api.scene.objects.length === 4, "undo should bring the 4 parts back");
  assert(restored === trisBefore, "undo should restore " + trisBefore + " tris, got " + restored);

  console.log("ok  his84 combine -> " + got.length + " tris match Bucket80.h (positions, oct normals, order); "
    + movedFaces + " shortened faces re-baked within 1 colour byte");

  // ----- crate: a diagonal plank across a recessed panel -----
  // cube_3 is one export of six parts (plank, cleaned bucket, grip, two arms, crate).
  // The plank is 4 triangles: a quad on the left panel plus two thin edges that run
  // into the frame. Combine should drop those two edges and pull the quad's corners
  // out of the frame onto the opening. The crate's own triangles stay put.
  const crateText = fs.readFileSync(path.join(fixDir, "cube_3.txt"), "utf8");
  const crateRows = parseHis(crateText);
  assert(crateRows.length === 192 * 3, "cube_3 should be 192 triangles, got " + (crateRows.length / 3));
  const crateOff = [0.03873622, 0.30441112, 0.03792348];
  const crateSc = 0.91715836;
  const built = componentsOf(crateRows);
  assert(built.byComp.length === 6, "cube_3 should be 6 parts, got " + built.byComp.length);
  assert(built.byComp[0].length === 4 && built.byComp[5].length === 108, "plank should be 4 tris and the crate 108");
  const names = ["plank", "bucket", "grip", "armL", "armR", "crate"];
  const parts = built.byComp.map((tris, i) => {
    const remap = new Map();
    const positions = [];
    const faces = [];
    for (const t of tris) {
      for (const v of t) {
        if (!remap.has(v)) {
          remap.set(v, positions.length / 3);
          const q = built.qpos[v];
          positions.push(crateOff[0] + (q[0] / POS_Q) * crateSc, crateOff[1] + (q[1] / POS_Q) * crateSc, crateOff[2] + (q[2] / POS_Q) * crateSc);
        }
        faces.push(remap.get(v));
      }
    }
    return api.makeObject(names[i] || "part", {
      positions, tris: faces,
      colors: Array.from({ length: faces.length / 3 }, () => grey.slice()),
      partner: [], mirror: null,
    }, [0, 0, 0]);
  });
  // Crate is the active object, so the join keeps its name. Order otherwise matches the file.
  const crateFirst = [parts[5], parts[0], parts[1], parts[2], parts[3], parts[4]];
  const crateTrisBefore = crateFirst.reduce((n, o) => n + o.mesh.tris.length / 3, 0);
  globalThis.__toasts.length = 0;
  api.scene = { name: "cube_3", active: 0, objects: crateFirst };
  api.mesh = crateFirst[0].mesh;
  api.objSel = new Set(crateFirst.map(o => o.id));
  api.cmdCombine();
  const crateToast = globalThis.__toasts.at(-1) || "";
  assert(api.triCount() === 190, "crate combine should be 190 tris, got " + api.triCount());
  assert(/tucked 4 verts, dropped 2 hidden faces/.test(crateToast), "unexpected crate toast: " + crateToast);
  const crateExport = parsePacked(api.buildExportPacked());
  const triPos = (t) => t.map(v => v.slice(0, 3).join(",")).join("|");
  // Original crate triangles, in file order, from the rows that belong to the big component.
  const crateKeys = new Set();
  for (const t of built.byComp[5]) {
    crateKeys.add(t.map(v => built.qpos[v].join(",")).join("|"));
  }
  let crateKept = 0;
  for (const t of crateExport) if (crateKeys.has(triPos(t))) crateKept++;
  assert(crateKept === 108, "crate should keep all 108 triangles, kept " + crateKept);
  const want = [
    [-2822, -25697, -8794],
    [-2822, -3936, 13257],
    [-2822, -22434, -13067],
    [-2822, 625, 10298],
  ];
  const have = new Set(crateExport.flat().map(v => v.slice(0, 3).join(",")));
  for (const p of want) assert(have.has(p.join(",")), "plank corner did not land on the opening: " + p.join(","));
  assert(!have.has("54,-915,16318") && !have.has("54,2875,12578"), "thin-edge vertices of the plank should be gone");
  api.undo();
  const crateBack = api.scene.objects.reduce((n, o) => n + o.mesh.tris.length / 3, 0);
  assert(api.scene.objects.length === 6, "undo should restore 6 parts");
  assert(crateBack === crateTrisBefore, "undo should restore " + crateTrisBefore + " tris, got " + crateBack);
  console.log("ok  cube_3 combine -> 190 tris (plank 4 -> 2, crate's 108 unchanged)");

  if (process.exitCode) process.exit(process.exitCode);
  console.log("all checks passed");
}

main();
