// Scene folders. Run from the repo root:  node test/scene-folders.mjs
//   Nested folders, moving a shape and a folder, undo of a move and of both
//   folder deletes, a .json round-trip (including the reserved pivot), and an
//   old scene file that has no folder tree.
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
    hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {},
    appendChild() { return el; },
    addEventListener() {},
    setAttribute() {},
    remove() {},
    select() {},
    setSelectionRange() {},
    getContext() { return null; },
    querySelectorAll: () => [],
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
  newScene, createFolder, renameFolder, deleteFolder, moveItems, toggleFolderHidden,
  selectFolderContents, sceneData, sceneFromJson, load, undo, pushUndo,
  shapeHidden, visibleForExport, buildExportPacked, makeObject, makeCube, parentIdOf,
  addObjects, ensureTree,
  get scene() { return scene; },
  get mesh() { return mesh; },
  get objSel() { return objSel; },
  get folderFocus() { return folderFocus; },
};
`;
  vm.runInThisContext(src, { filename: "index.html" });
  return globalThis.__vertTest;
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
}

function sketch(api) {
  const nameOf = (id) => {
    const o = api.scene.objects.find(x => x.id === id);
    return o ? o.name : "?";
  };
  const walk = (nodes) => (nodes || []).map(n => n.kind === "object"
    ? nameOf(n.id)
    : n.name + "{" + walk(n.children).join(" ") + "}");
  return walk(api.scene.tree).join(" ");
}

function byName(api, name) {
  return api.scene.objects.find(o => o.name === name);
}

function main() {
  const api = loadModeler();
  api.newScene("x");
  const model = api.scene.objects[0];
  assert(model.name === "model", "new scene starts with model");
  assert(sketch(api) === "model", "new scene is a flat list, got " + sketch(api));

  const trees = api.createFolder("trees", null);
  const oaks = api.createFolder("oaks", trees.id);
  assert(oaks && trees, "createFolder returns the live folder");
  assert(api.parentIdOf("folder", oaks.id) === trees.id, "oaks nests inside trees");
  assert(sketch(api) === "model trees{oaks{}}", "nested folders beside the shape, got " + sketch(api));

  const expBefore = api.buildExportPacked(model);
  assert(api.moveItems([{ kind: "object", id: model.id }], oaks.id) === "ok", "move shape into oaks");
  assert(api.parentIdOf("object", model.id) === oaks.id, "model now lives in oaks");
  assert(api.buildExportPacked(model) === expBefore, "putting a shape in a folder must not change its .h export");

  const rockMesh = api.makeCube(null);
  const rock = api.makeObject("rock", rockMesh, [2, 0, 0]);
  rock._folder = null;
  api.addObjects([rock]);
  assert(api.parentIdOf("object", rock.id) === null, "a shape aimed at the root stays at the root");
  assert(byName(api, "rock"), "rock was added");

  const world = api.createFolder("world", null);
  assert(api.moveItems([{ kind: "folder", id: trees.id }], world.id) === "ok", "move a folder into a folder");
  assert(api.parentIdOf("folder", trees.id) === world.id, "trees now lives in world");
  assert(api.parentIdOf("object", model.id) === oaks.id, "a shape keeps its folder when that folder moves");
  assert(sketch(api) === "rock world{trees{oaks{model}}}", "nesting after the moves, got " + sketch(api));
  assert(api.moveItems([{ kind: "folder", id: world.id }], trees.id) === "into-self", "a folder cannot move into itself");
  assert(api.parentIdOf("folder", trees.id) === world.id, "rejected move leaves the tree alone");

  assert(api.moveItems([{ kind: "object", id: model.id }], null) === "ok", "move shape out to the root");
  assert(api.parentIdOf("object", model.id) === null, "model is back at the root");
  api.undo();
  assert(api.parentIdOf("object", model.id) === oaks.id, "undo puts the shape back in oaks");

  // Reserved part-group pivot, collapse, and folder hide survive a file round-trip.
  const liveOaks = api.scene.tree[1].children[0].children[0];
  assert(liveOaks.name === "oaks", "oaks is world/trees/oaks before the save");
  liveOaks.pivot = [1, 2, 3];
  liveOaks.open = false;
  liveOaks.hidden = true;
  const saved = JSON.parse(JSON.stringify(api.sceneData()));
  assert(Array.isArray(saved.tree) && saved.tree.some(n => n.kind === "folder"), "scene json stores a folder tree");
  const packedModel = api.buildExportPacked(byName(api, "model"));
  api.sceneFromJson(saved, true);
  assert(sketch(api) === "rock world{trees{oaks{model}}}", "round-trip keeps the outline, got " + sketch(api));
  const loadedOaks = api.scene.tree[1].children[0].children[0];
  assert(loadedOaks.pivot[0] === 1 && loadedOaks.pivot[1] === 2 && loadedOaks.pivot[2] === 3, "pivot round-trips");
  assert(loadedOaks.open === false, "collapsed state round-trips");
  assert(loadedOaks.hidden === true, "folder hide round-trips");
  assert(api.shapeHidden(byName(api, "model")), "a shape in a hidden folder stays hidden");
  assert(!api.shapeHidden(byName(api, "rock")), "a shape outside that folder stays visible");
  assert(!api.visibleForExport().some(o => o.name === "model"), "folder-hidden shapes drop out of the visible export list");
  assert(api.visibleForExport().some(o => o.name === "rock"), "visible shapes stay in the export list");
  assert(api.buildExportPacked(byName(api, "model")) === packedModel, "the shape's own .h text is unchanged by the folder");
  assert(api.scene.objects[api.scene.active].name === "rock", "the active shape is still the one that was showing");

  api.toggleFolderHidden(loadedOaks.id);
  assert(!api.shapeHidden(byName(api, "model")), "showing the folder shows the shape again");
  const nSel = api.selectFolderContents(loadedOaks.id);
  assert(nSel === 1 && api.objSel.has(byName(api, "model").id), "select all picks the shape in the folder");

  // Deleting a folder asks, in code, which way: lift keeps shapes, drop removes them, both undo.
  api.newScene("x");
  const box = api.createFolder("box", null);
  const cube = api.scene.objects[0];
  api.moveItems([{ kind: "object", id: cube.id }], box.id);
  const other = api.makeObject("other", api.makeCube(null), [3, 0, 0]);
  other._folder = null;
  api.addObjects([other]);
  assert(api.deleteFolder(box.id, "lift").ok, "lift delete");
  assert(!api.scene.tree.some(n => n.kind === "folder"), "lift removes the folder");
  assert(api.parentIdOf("object", cube.id) === null, "lift moves the shape up to the parent");
  assert(api.scene.objects.some(o => o.id === cube.id), "lift does not delete the shape");
  api.undo();
  assert(api.parentIdOf("object", cube.id) === box.id, "undo restores the folder and its shape");

  const dropped = api.deleteFolder(box.id, "drop");
  assert(dropped.ok && dropped.removed === 1, "drop delete removes the one shape inside, got " + JSON.stringify(dropped));
  assert(!api.scene.objects.some(o => o.name === "model"), "the shape inside the folder is gone");
  assert(api.scene.objects.some(o => o.name === "other"), "a shape outside the folder stays");
  api.undo();
  assert(api.scene.objects.some(o => o.name === "model"), "undo brings the deleted shape back");
  assert(api.parentIdOf("object", byName(api, "model").id) === box.id, "undo restores which folder it was in");

  api.moveItems([{ kind: "object", id: byName(api, "other").id }], box.id);
  const refused = api.deleteFolder(box.id, "drop");
  assert(!refused.ok && refused.reason === "all", "drop refuses to delete every shape");
  assert(api.scene.objects.length === 2, "refused delete changes nothing");

  // An old scene file has objects and no tree. Everything loads at the root.
  const fresh = api.sceneData();
  const legacy = { name: "legacy", active: 0, objects: fresh.objects };
  assert(!("tree" in legacy), "the fixture really has no tree");
  const n = api.sceneFromJson(legacy, true);
  assert(n === fresh.objects.length, "legacy file loads every object");
  assert(api.scene.tree.every(node => node.kind === "object"), "legacy file has no folders");
  assert(api.scene.tree.map(node => node.id).join() === api.scene.objects.map(o => o.id).join(), "root order follows the file");
  assert(api.scene.name === "legacy", "legacy scene name loads");
  assert(!api.scene.tree.some(node => node.kind === "folder"), "no folder was invented");

  store.set("vert-modeler-v2", JSON.stringify({
    v: 3,
    scene: { name: "autosave", active: 0, objects: fresh.objects },
    currentColor: [1, 1, 1],
    snapOn: false,
    bakeOn: true,
  }));
  api.load();
  assert(api.scene.name === "autosave", "old autosave name loads");
  assert(api.scene.tree.every(node => node.kind === "object"), "old autosave has no folders");
  assert(api.scene.objects.length === fresh.objects.length, "old autosave keeps every object");

  console.log("ok  nested folders, moves, undo, round-trip, legacy scene");
}

main();
