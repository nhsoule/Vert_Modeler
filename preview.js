"use strict";
// Animation preview. Opens a scene header (several models in one .h) and plays a
// motion rule per model. The rules are the JSON documented in the README.
// The packed-vert reader follows Import in index.html:
//   world = placed + offset + (pos / 32767) * scale
// placed is the "placed at (x, y, z)" pivot. Colours are the baked rgba bytes.
(function () {

//----- Constants -----||
const POS_Q = 32767;
const FOV_Y = 50 * Math.PI / 180;
const SKY_TOP = [0.62, 0.79, 0.97];
const SKY_HOR = [0.99, 0.87, 0.89];
const RESERVED = new Set(["t", "pi", "lineSpan"]);
const EXAMPLE_NAMES = ["Bucket", "Bucket_ore", "Guide_Axle_1", "Guide_Axle_2", "Stanchion", "Balloon", "Stake", "Rope"];
const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

//----- Small Vector Math -----||
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
};
function norm(a) { const l = v3.len(a) || 1; return v3.scale(a, 1 / l); }
function mul3(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}
// Column-major 3x3, right-handed. Angle is radians.
function rotAxis(axis, angle) {
  const a = norm(axis), x = a[0], y = a[1], z = a[2];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c,     t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c,     t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  ];
}
function num(v, fallback) { const n = +v; return Number.isFinite(n) ? n : fallback; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

//----- Expressions -----||
// Numbers, names (t, pi, lineSpan, slider ids), + - * /, and
// sin cos tan abs sqrt floor min max pow mod clamp pingpong.
function compileExpr(text) {
  const src = String(text == null ? "" : text).trim();
  if (!src) return { ok: true, fn: () => 0, error: "" };
  if (src.length > 240) return { ok: false, fn: () => 0, error: "expression is too long" };
  let i = 0;
  function skip() { while (i < src.length && " \t\n\r".includes(src[i])) i++; }
  function parseExpr() { return parseAdd(); }
  function parseAdd() {
    let left = parseMul();
    for (;;) {
      skip();
      if (src[i] === "+") { i++; const r = parseMul(); const l = left; left = (v) => l(v) + r(v); }
      else if (src[i] === "-") { i++; const r = parseMul(); const l = left; left = (v) => l(v) - r(v); }
      else break;
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    for (;;) {
      skip();
      if (src[i] === "*") { i++; const r = parseUnary(); const l = left; left = (v) => l(v) * r(v); }
      else if (src[i] === "/") { i++; const r = parseUnary(); const l = left; left = (v) => l(v) / r(v); }
      else break;
    }
    return left;
  }
  function parseUnary() {
    skip();
    if (src[i] === "+") { i++; return parseUnary(); }
    if (src[i] === "-") { i++; const r = parseUnary(); return (v) => -r(v); }
    return parsePrimary();
  }
  function parsePrimary() {
    skip();
    if (src[i] === "(") {
      i++;
      const e = parseExpr();
      skip();
      if (src[i] !== ")") throw new Error("missing )");
      i++;
      return e;
    }
    const numM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (numM) { i += numM[0].length; const n = Number(numM[0]); return () => n; }
    const idM = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (!idM) throw new Error("bad expression");
    i += idM[0].length;
    const id = idM[0];
    skip();
    if (src[i] === "(") {
      i++;
      const args = [];
      skip();
      if (src[i] !== ")") {
        for (;;) {
          args.push(parseExpr());
          skip();
          if (src[i] === ",") { i++; continue; }
          break;
        }
      }
      skip();
      if (src[i] !== ")") throw new Error("missing )");
      i++;
      return callFn(id, args);
    }
    if (id === "pi") return () => Math.PI;
    return (env) => {
      const n = env[id];
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    };
  }
  try {
    const fn0 = parseExpr();
    skip();
    if (i < src.length) throw new Error("leftover " + src.slice(i));
    const fn = (env) => {
      const n = fn0(env || {});
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    };
    fn({ t: 0 });
    return { ok: true, fn, error: "" };
  } catch (e) {
    return { ok: false, fn: () => 0, error: e.message || "bad expression" };
  }
}
function callFn(id, args) {
  const one = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor };
  if (one[id]) {
    if (args.length !== 1) throw new Error(id + " needs 1 value");
    const f = one[id], a = args[0];
    return (v) => f(a(v));
  }
  if (id === "min" || id === "max") {
    if (args.length < 2) throw new Error(id + " needs 2 values");
    const f = Math[id];
    return (v) => f(...args.map((a) => a(v)));
  }
  if (id === "pow") {
    if (args.length !== 2) throw new Error("pow needs 2 values");
    return (v) => Math.pow(args[0](v), args[1](v));
  }
  if (id === "mod") {
    if (args.length !== 2) throw new Error("mod needs 2 values");
    return (v) => { const b = args[1](v); if (!b) return 0; return ((args[0](v) % b) + b) % b; };
  }
  if (id === "clamp") {
    if (args.length !== 3) throw new Error("clamp needs 3 values");
    return (v) => {
      const a = args[1](v), b = args[2](v);
      return clamp(args[0](v), Math.min(a, b), Math.max(a, b));
    };
  }
  if (id === "pingpong") {
    if (args.length !== 2) throw new Error("pingpong needs 2 values");
    return (v) => pingpong(args[0](v), args[1](v));
  }
  throw new Error("unknown function " + id);
}
// 0..length, then back to 0, then out again. length 0 stays at 0.
function pingpong(x, length) {
  if (!(length > 0) || !Number.isFinite(x)) return 0;
  const p = length * 2;
  let m = x % p;
  if (m < 0) m += p;
  return m <= length ? m : p - m;
}
const exprCache = new Map();
function evalExpr(text, env) {
  const key = String(text == null ? "" : text);
  let c = exprCache.get(key);
  if (!c) { c = compileExpr(key); exprCache.set(key, c); }
  return c.fn(env);
}

//----- Header Import -----||
// Split and read the same way Import does. Several "#pragma once" blocks, or
// several "// Name: N triangles" headers, are several models.
function isPackedExport(text) {
  if (/#include\s+"vert\.h"/.test(text)) return true;
  if (/struct\s+Vert\b/.test(text)) return true;
  if (/int16_t\s+pos\s*\[/.test(text)) return true;
  if (/octDecode\s*\(/.test(text)) return true;
  if (/\bVert\s+[A-Za-z_][A-Za-z0-9_]*_verts\s*\[/.test(text)) return true;
  return /\{\s*\{\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\}\s*,\s*\{\s*-?\d+\s*,\s*-?\d+\s*\}\s*,\s*\{\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\}\s*\}/.test(text);
}
function parsePlaced(text) {
  const m = text.match(/placed at\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/);
  if (!m) return [0, 0, 0];
  const v = [m[1], m[2], m[3]].map(Number);
  return v.every(Number.isFinite) ? v : [0, 0, 0];
}
function splitExports(text) {
  let cuts = [...text.matchAll(/^[ \t]*#pragma once/gm)].map((m) => m.index);
  if (cuts.length < 2) cuts = [...text.matchAll(/^\/\/ [A-Za-z_][A-Za-z0-9_]*: \d+ triangles/gm)].map((m) => m.index);
  if (cuts.length < 2) return [text];
  return cuts.map((c, i) => text.slice(i ? c : 0, i + 1 < cuts.length ? cuts[i + 1] : text.length));
}
function parsePacked(text) {
  const nameMatch = text.match(/([A-Za-z_][A-Za-z0-9_]*)_verts\s*\[/);
  const offM = text.match(/_offset\s*\[\s*3\s*\]\s*=\s*\{([^}]*)\}/);
  const scM = text.match(/_scale\s*=\s*([-+0-9.eE]+)/);
  if (!offM || !scM) throw new Error("12-byte export is missing offset or scale");
  const offset = offM[1].split(",").map((s) => parseFloat(s));
  const scale = parseFloat(scM[1]);
  if (offset.length !== 3 || offset.some((n) => !Number.isFinite(n)) || !(scale > 0))
    throw new Error("bad offset or scale");
  const placed = parsePlaced(text);
  const re = /\{\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*\{\s*-?\d+\s*,\s*-?\d+\s*\}\s*,\s*\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*\}\s*\}/g;
  const rest = [];
  let m;
  while ((m = re.exec(text))) {
    for (let k = 0; k < 3; k++) rest.push(placed[k] + offset[k] + (+m[k + 1] / POS_Q) * scale);
    rest.push(+m[4] / 255, +m[5] / 255, +m[6] / 255);
  }
  if (rest.length < 18 || rest.length % 18) throw new Error("needs whole triangles of Vert");
  return { name: nameMatch ? nameMatch[1] : "model", placed, rest: new Float32Array(rest) };
}
function parseFloats(text) {
  const nameMatch = text.match(/([A-Za-z_][A-Za-z0-9_]*)_verts\s*\[/);
  let body = text;
  const open = nameMatch ? text.indexOf("{", nameMatch.index) : text.indexOf("{");
  if (open >= 0) {
    const close = text.lastIndexOf("}");
    body = text.slice(open + 1, close >= 0 ? close : undefined);
  }
  body = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const nums = (body.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n))) throw new Error("no vertex numbers");
  let stride = 0;
  if (/normal3/.test(text) || /stride\s+9\s*\*/.test(text)) stride = 9;
  else if (/stride\s+6\s*\*/.test(text)) stride = 6;
  else if (nums.length % 27 === 0 && nums.length % 18 !== 0) stride = 9;
  else if (nums.length % 18 === 0) stride = 6;
  const perTri = stride * 3;
  if (!stride || nums.length < perTri || nums.length % perTri) throw new Error("not a whole number of triangles");
  const placed = parsePlaced(text);
  const rest = [];
  for (let t = 0; t < nums.length / perTri; t++) {
    const base = t * perTri;
    for (let k = 0; k < 3; k++) {
      rest.push(placed[0] + nums[base + k * stride], placed[1] + nums[base + k * stride + 1], placed[2] + nums[base + k * stride + 2]);
      rest.push(nums[base + k * stride + 3], nums[base + k * stride + 4], nums[base + k * stride + 5]);
    }
  }
  return { name: nameMatch ? nameMatch[1] : "model", placed, rest: new Float32Array(rest) };
}
function parseScene(text) {
  const models = [], errors = [], used = new Set();
  for (const chunk of splitExports(String(text || ""))) {
    if (!chunk.trim()) continue;
    try {
      const parsed = isPackedExport(chunk) ? parsePacked(chunk) : parseFloats(chunk);
      let name = parsed.name || "model";
      if (used.has(name)) {
        let k = 2;
        while (used.has(name + "_" + k)) k++;
        name = name + "_" + k;
      }
      used.add(name);
      parsed.name = name;
      parsed.count = parsed.rest.length / 6;
      models.push(parsed);
    } catch (e) { errors.push(e.message || "bad header"); }
  }
  return { models, errors };
}

//----- Rope Shape -----||
// A rope is a thin span with optional fat coils at the ends. Span vertices remember
// how far along the rest centreline they sit, and their offset from a sagging curve
// fitted to that centreline. Coil vertices keep their rest position and later move
// with whichever model that end is attached to.
function principalAxis(pts) {
  const mean = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) mean[k] += p[k];
  for (let k = 0; k < 3; k++) mean[k] /= pts.length || 1;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a][b] += d[a] * d[b];
  }
  let v = [0.3, 0.5, 0.8];
  for (let it = 0; it < 32; it++) {
    const n = [0, 0, 0];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) n[a] += c[a][b] * v[b];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) return [0, 0, 1];
    v = [n[0] / l, n[1] / l, n[2] / l];
  }
  // Largest component positive, so end A/B don't swap between loads.
  const ax = Math.abs(v[0]) >= Math.abs(v[1]) && Math.abs(v[0]) >= Math.abs(v[2]) ? 0 : Math.abs(v[1]) >= Math.abs(v[2]) ? 1 : 2;
  if (v[ax] < 0) v = [-v[0], -v[1], -v[2]];
  return v;
}
function bindRope(points) {
  const n = points.length;
  if (n < 2) return null;
  const uniq = [];
  const indexOf = new Map();
  const keyOf = (p) => p[0].toFixed(4) + "," + p[1].toFixed(4) + "," + p[2].toFixed(4);
  for (let i = 0; i < n; i++) {
    const k = keyOf(points[i]);
    if (!indexOf.has(k)) { indexOf.set(k, uniq.length); uniq.push(points[i]); }
  }
  if (uniq.length < 2) return null;
  const nn = [];
  for (let i = 0; i < uniq.length; i++) {
    let best = Infinity;
    for (let j = 0; j < uniq.length; j++) if (j !== i) {
      const d = v3.len(v3.sub(uniq[i], uniq[j]));
      if (d < best) best = d;
    }
    nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const eps = Math.max((nn[nn.length >> 1] || 0.02) * 2.4, 1e-4);
  const parent = uniq.map((_, i) => i);
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    if (v3.len(v3.sub(uniq[i], uniq[j])) <= eps) {
      const ra = find(i), rb = find(j);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const groups = new Map();
  for (let i = 0; i < uniq.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const axis = principalAxis(uniq);
  let clusters = [...groups.values()].map((idxs) => {
    const c = [0, 0, 0];
    for (const i of idxs) for (let k = 0; k < 3; k++) c[k] += uniq[i][k];
    for (let k = 0; k < 3; k++) c[k] /= idxs.length;
    return { idxs, c, n: idxs.length, t: v3.dot(c, axis) };
  });
  clusters.sort((a, b) => a.t - b.t);
  const mark = coilMarks(clusters);
  const clOf = new Array(uniq.length);
  clusters.forEach((cl, ci) => { for (const i of cl.idxs) clOf[i] = ci; });

  const endRun = (fromStart) => {
    const ids = [];
    for (let k = 0; k < mark.length; k++) {
      const i = fromStart ? k : mark.length - 1 - k;
      if (!mark[i]) break;
      ids.push(i);
    }
    return ids;
  };
  const end0 = endRun(true), end1 = endRun(false);
  function centroid(ids) {
    const c = [0, 0, 0];
    let count = 0;
    for (const ci of ids) for (const ui of clusters[ci].idxs) {
      for (let k = 0; k < 3; k++) c[k] += uniq[ui][k];
      count++;
    }
    return count ? c.map((v) => v / count) : clusters[ids[0]].c.slice();
  }
  const samples = [];
  if (end0.length) samples.push(centroid(end0));
  for (let ci = 0; ci < clusters.length; ci++) if (!mark[ci]) samples.push(clusters[ci].c.slice());
  if (end1.length) samples.push(centroid(end1));
  if (samples.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < samples.length; i++) cum.push(cum[i - 1] + v3.len(v3.sub(samples[i], samples[i - 1])));
  const total = cum[cum.length - 1] || 1;
  const sAt = samples.map((_, i) => cum[i] / total);

  // s of each span cluster: the sample that is that cluster's centroid.
  const sOf = new Array(clusters.length).fill(0);
  let si = end0.length ? 1 : 0;
  for (let ci = 0; ci < clusters.length; ci++) if (!mark[ci]) { sOf[ci] = sAt[si]; si++; }

  const endPoint = [samples[0].slice(), samples[samples.length - 1].slice()];
  const sampleRecs = samples.map((p, i) => ({ s: sAt[i], p: p.slice() }));
  const verts = [];
  let lead = 0;
  while (lead < mark.length && mark[lead]) lead++;
  for (let i = 0; i < n; i++) {
    const ui = indexOf.get(keyOf(points[i]));
    const ci = clOf[ui];
    const rest = points[i].slice();
    if (mark[ci]) verts.push({ coil: true, end: ci < lead ? 0 : 1, rest });
    else verts.push({ coil: false, s: sOf[ci], rest, u: 0, v: 0, w: 0 });
  }
  return { endPoint, samples: sampleRecs, verts, sagFit: 0 };
}
function coilMarks(clusters) {
  const n = clusters.length;
  const mark = new Array(n).fill(false);
  if (!n) return mark;
  const counts = clusters.map((c) => c.n).sort((a, b) => a - b);
  const med = counts[counts.length >> 1] || 1;
  const cut = Math.max(med * 2.5, med + 3);
  const big = (i) => clusters[i].n >= cut;
  if (!clusters.some((_, i) => big(i))) return mark;
  function markEnd(fromStart) {
    let seen = false;
    const touched = [];
    for (let k = 0; k < n; k++) {
      const i = fromStart ? k : n - 1 - k;
      if (big(i)) seen = true;
      else if (seen) break;
      mark[i] = true;
      touched.push(i);
      if (seen) {
        if (k + 1 >= n) break;
        const j = fromStart ? k + 1 : n - 1 - (k + 1);
        if (!big(j)) break;
      }
    }
    if (!seen) for (const i of touched) mark[i] = false;
  }
  markEnd(true);
  markEnd(false);
  if (mark.every(Boolean)) mark.fill(false);
  return mark;
}
// Sag direction: world down, with the part parallel to the chord removed.
function sagDirection(A, B) {
  const d = v3.sub(B, A);
  const L = v3.len(d);
  if (L < 1e-6) return [0, -1, 0];
  const dir = v3.scale(d, 1 / L);
  let down = v3.sub([0, 0, -1], v3.scale(dir, v3.dot([0, 0, -1], dir)));
  const dl = v3.len(down);
  if (dl < 1e-4) return [0, -1, 0];
  return v3.scale(down, 1 / dl);
}
// s is 0 at A and 1 at B. sag is the mid-span drop as a fraction of |B-A|.
function curvePoint(A, B, s, sag) {
  const d = v3.sub(B, A);
  const L = v3.len(d);
  const base = v3.add(A, v3.scale(d, s));
  if (L < 1e-6) return base;
  const drop = sag * L * 4 * s * (1 - s);
  return v3.add(base, v3.scale(sagDirection(A, B), drop));
}
function curveTangent(A, B, s, sag) {
  const ds = 0.002;
  const p0 = curvePoint(A, B, Math.max(0, s - ds), sag);
  const p1 = curvePoint(A, B, Math.min(1, s + ds), sag);
  let T = v3.sub(p1, p0);
  if (v3.len(T) < 1e-8) T = v3.sub(B, A);
  if (v3.len(T) < 1e-8) return [1, 0, 0];
  return norm(T);
}
// N is the up-ish axis, B the side axis, T the tangent. World up, unless the
// rope is nearly vertical, in which case world Y stands in for up.
function frameFromTangent(T) {
  let up = [0, 0, 1];
  if (Math.abs(v3.dot(T, up)) > 0.92) up = [0, 1, 0];
  const B = norm(v3.cross(T, up));
  const N = v3.cross(B, T);
  return { T, N, B };
}
function curveFrame(A, B, s, sag) {
  const p = curvePoint(A, B, s, sag);
  return { p, ...frameFromTangent(curveTangent(A, B, s, sag)) };
}
function fitSag(bind) {
  const samples = bind.samples.filter((sm) => sm.s > 0.02 && sm.s < 0.98);
  const use = samples.length ? samples : bind.samples;
  let best = 0, bestE = Infinity;
  for (let k = 0; k <= 100; k++) {
    const sag = k / 100 * 0.5;
    let e = 0;
    for (const sm of use) e += v3.len(v3.sub(sm.p, curvePoint(bind.endPoint[0], bind.endPoint[1], sm.s, sag)));
    if (e < bestE) { bestE = e; best = sag; }
  }
  return Math.round(best * 1000) / 1000;
}
// Offsets are measured from the fitted curve, so sag = sagFit reproduces the mesh.
function stampRope(bind, sag) {
  const A = bind.endPoint[0], B = bind.endPoint[1];
  for (const rec of bind.verts) {
    if (rec.coil) continue;
    const fr = curveFrame(A, B, rec.s, sag);
    const off = v3.sub(rec.rest, fr.p);
    rec.u = v3.dot(off, fr.N);
    rec.v = v3.dot(off, fr.B);
    rec.w = v3.dot(off, fr.T);
  }
  bind.sagFit = sag;
}
function prepareRope(model) {
  if (model._rope !== undefined) return model._rope;
  const pts = [];
  for (let i = 0; i < model.count; i++) pts.push([model.rest[i * 6], model.rest[i * 6 + 1], model.rest[i * 6 + 2]]);
  const bind = bindRope(pts);
  if (bind) stampRope(bind, fitSag(bind));
  model._rope = bind;
  return bind;
}

//----- Motion -----||
function axisVec(a) {
  if (Array.isArray(a) && a.length === 3) return norm(a.map(Number));
  if (a === "x") return [1, 0, 0];
  if (a === "y") return [0, 1, 0];
  return [0, 0, 1];
}
function makeEnv(doc, time) {
  const env = { t: time };
  const line = doc.line || {};
  env.lineSpan = num(line.spacing, 0) * Math.max(0, Math.round(num(line.count, 1)) - 1);
  for (const s of doc.sliders || []) env[s.id] = s.value;
  env.t = time;
  env.pi = Math.PI;
  env.lineSpan = num(line.spacing, 0) * Math.max(0, Math.round(num(line.count, 1)) - 1);
  return env;
}
function bobTranslation(channels, env, phaseExtra) {
  const T = [0, 0, 0];
  for (const ch of channels || []) {
    const amount = ch.amount.trim() === "" ? 1 : evalExpr(ch.amount, env);
    const period = ch.period > 0 ? ch.period : 1;
    const s = Math.sin((2 * Math.PI * env.t) / period + (ch.phase || 0) + (phaseExtra || 0)) * ch.amplitude * amount;
    const a = axisVec(ch.axis);
    T[0] += a[0] * s; T[1] += a[1] * s; T[2] += a[2] * s;
  }
  return T;
}
function rigidBody(rule, motion, env, phaseExtra) {
  const pivot = rule.pivot.slice();
  if (motion.type === "bob") return { R: IDENT3.slice(), T: bobTranslation(motion.channels, env, phaseExtra), pivot };
  if (motion.type === "spin") return { R: rotAxis(axisVec(motion.axis), evalExpr(motion.angle, env)), T: [0, 0, 0], pivot };
  if (motion.type === "slide") {
    const d = evalExpr(motion.distance, env);
    const a = axisVec(motion.axis);
    return { R: IDENT3.slice(), T: [a[0] * d, a[1] * d, a[2] * d], pivot };
  }
  return { R: IDENT3.slice(), T: [0, 0, 0], pivot };
}
function cloneXf(x) { return { R: x.R.slice(), T: x.T.slice(), pivot: x.pivot.slice() }; }
// Rigid motion of every model. Follow copies the target's transform (rotation
// about the target's pivot). A cycle, or a missing target, stays put.
function computeTransforms(modelList, rules, env) {
  const xf = new Map();
  for (const m of modelList) {
    const rule = rules[m.name] || { pivot: m.placed.slice(), motion: { type: "none" } };
    xf.set(m.name, rigidBody(rule, rule.motion.type === "follow" || rule.motion.type === "deform-rope" ? { type: "none" } : rule.motion, env, 0));
  }
  const pending = new Set();
  for (const m of modelList) if (rules[m.name] && rules[m.name].motion.type === "follow") pending.add(m.name);
  for (let pass = 0; pass < modelList.length + 1 && pending.size; pass++) {
    let moved = false;
    for (const name of [...pending]) {
      const target = rules[name].motion.target;
      if (!target || !xf.has(target) || target === name) { pending.delete(name); continue; }
      if (pending.has(target)) continue;
      xf.set(name, cloneXf(xf.get(target)));
      pending.delete(name);
      moved = true;
    }
    if (!moved) break;
  }
  return xf;
}
function livePoint(p, name, xf) {
  if (!name || !xf.has(name)) return p.slice();
  const m = xf.get(name);
  return v3.add(v3.add(mul3(m.R, v3.sub(p, m.pivot)), m.pivot), m.T);
}
function deformRope(model, motion, xf, env) {
  const bind = prepareRope(model);
  if (!model.dyn || model.dyn.length !== model.rest.length) model.dyn = new Float32Array(model.rest.length);
  model.dyn.set(model.rest);
  if (!bind) return model.dyn;
  const sag = evalExpr(motion.sag, env);
  const A = livePoint(bind.endPoint[0], motion.endA, xf);
  const B = livePoint(bind.endPoint[1], motion.endB, xf);
  for (let i = 0; i < model.count; i++) {
    const rec = bind.verts[i];
    let p;
    if (rec.coil) p = livePoint(rec.rest, rec.end === 0 ? motion.endA : motion.endB, xf);
    else {
      const fr = curveFrame(A, B, rec.s, sag);
      p = v3.add(fr.p, v3.add(v3.add(v3.scale(fr.N, rec.u), v3.scale(fr.B, rec.v)), v3.scale(fr.T, rec.w)));
    }
    model.dyn[i * 6] = p[0]; model.dyn[i * 6 + 1] = p[1]; model.dyn[i * 6 + 2] = p[2];
  }
  return model.dyn;
}

//----- Rules Document -----||
function defaultSliders() {
  return [
    { id: "lineSpeed", label: "Line speed", min: -2, max: 2, value: 0.8, step: 0.01 },
    { id: "wind", label: "Wind / bob", min: 0, max: 2, value: 1, step: 0.01 },
    { id: "sag", label: "Sag", min: 0, max: 0.5, value: 0.13, step: 0.005 },
  ];
}
function defaultLine() {
  return { enabled: false, model: "", count: 4, spacing: 3, axis: "x", sag: "sag", phaseStep: 0, anchor: [0, 0, 0] };
}
function defaultChannel() {
  return { axis: "z", amplitude: 0.05, period: 2.5, phase: 0, amount: "1" };
}
function freshDocument(modelList) {
  const doc = { version: 1, sliders: defaultSliders(), line: defaultLine(), rules: {} };
  if (modelList[0]) doc.line.model = modelList[0].name;
  for (const m of modelList) doc.rules[m.name] = { pivot: m.placed.slice(), motion: { type: "none" } };
  return doc;
}
function isExample(modelList) {
  const s = new Set(modelList.map((m) => m.name));
  return EXAMPLE_NAMES.every((n) => s.has(n));
}
function modelMean(model) {
  const c = [0, 0, 0];
  for (let i = 0; i < model.count; i++) for (let k = 0; k < 3; k++) c[k] += model.rest[i * 6 + k];
  return v3.scale(c, 1 / (model.count || 1));
}
function wheelRadius(model, pivot) {
  let r = 0;
  for (let i = 0; i < model.count; i++) {
    const d = Math.hypot(model.rest[i * 6] - pivot[0], model.rest[i * 6 + 2] - pivot[2]);
    if (d > r) r = d;
  }
  return Math.max(0.05, Math.round(r * 1000) / 1000);
}
function exampleDocument(modelList) {
  const by = Object.fromEntries(modelList.map((m) => [m.name, m]));
  const doc = freshDocument(modelList);
  doc.line.enabled = true;
  doc.line.model = by.Stanchion ? "Stanchion" : (modelList[0] ? modelList[0].name : "");
  doc.line.count = 4;
  doc.line.spacing = 3;
  doc.line.axis = "x";
  doc.line.sag = "sag";
  doc.line.phaseStep = 0;
  if (by.Stanchion) doc.rules.Stanchion.motion = {
    type: "bob",
    channels: [
      { axis: "z", amplitude: 0.07, period: 2.8, phase: 0, amount: "wind" },
      { axis: "y", amplitude: 0.02, period: 3.6, phase: 0, amount: "wind" },
    ],
  };
  if (by.Balloon) doc.rules.Balloon.motion = { type: "follow", target: "Stanchion" };
  if (by.Stake) doc.rules.Stake.motion = { type: "none" };
  const travel = "pingpong(lineSpeed * t, lineSpan)";
  for (const name of ["Guide_Axle_1", "Guide_Axle_2"]) if (by[name]) {
    const r = wheelRadius(by[name], doc.rules[name].pivot);
    doc.rules[name].motion = { type: "spin", axis: "y", angle: travel + " / " + r };
  }
  for (const name of ["Bucket", "Bucket_ore"]) if (by[name]) {
    doc.rules[name].motion = { type: "slide", axis: "x", distance: travel };
  }
  if (by.Rope) {
    const bind = prepareRope(by.Rope);
    let endA = by.Stake ? "Stake" : "";
    let endB = by.Stanchion ? "Stanchion" : "";
    if (bind && by.Stake && by.Stanchion) {
      const stake = modelMean(by.Stake), st = modelMean(by.Stanchion);
      const d0s = v3.len(v3.sub(bind.endPoint[0], stake)), d0t = v3.len(v3.sub(bind.endPoint[0], st));
      if (d0s <= d0t) { endA = "Stake"; endB = "Stanchion"; }
      else { endA = "Stanchion"; endB = "Stake"; }
    }
    doc.rules.Rope.motion = { type: "deform-rope", endA, endB, sag: "sag" };
    if (bind) {
      const sag = doc.sliders.find((s) => s.id === "sag");
      if (sag) sag.value = bind.sagFit;
      if (by.Stanchion) {
        const idx = endA === "Stanchion" ? 0 : 1;
        doc.line.anchor = v3.sub(bind.endPoint[idx], doc.rules.Stanchion.pivot).map((v) => Math.round(v * 1e6) / 1e6);
      }
    }
  }
  return doc;
}
function axisOk(a, fallback) {
  if (a === "x" || a === "y" || a === "z") return a;
  if (Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(+v))) return a.map(Number);
  return fallback;
}
function sanitizeChannel(c) {
  if (!c || typeof c !== "object") return null;
  return {
    axis: axisOk(c.axis, "z"),
    amplitude: num(c.amplitude, 0.05),
    period: Math.max(0.05, num(c.period, 2.5)),
    phase: num(c.phase, 0),
    amount: String(c.amount == null ? "1" : c.amount),
  };
}
function sanitizeMotion(m, modelList, self) {
  const names = new Set(modelList.map((x) => x.name));
  const other = (v) => (v && names.has(v) && v !== self) ? v : "";
  if (!m || typeof m !== "object") return { type: "none" };
  if (m.type === "spin") return { type: "spin", axis: axisOk(m.axis, "y"), angle: String(m.angle == null ? "t" : m.angle) };
  if (m.type === "slide") return { type: "slide", axis: axisOk(m.axis, "x"), distance: String(m.distance == null ? "t" : m.distance) };
  if (m.type === "follow") return { type: "follow", target: other(m.target) };
  if (m.type === "deform-rope") return {
    type: "deform-rope", endA: other(m.endA), endB: other(m.endB), sag: String(m.sag == null ? "sag" : m.sag),
  };
  if (m.type === "bob") {
    const channels = Array.isArray(m.channels) ? m.channels.map(sanitizeChannel).filter(Boolean) : [defaultChannel()];
    return { type: "bob", channels };
  }
  return { type: "none" };
}
function sanitize(data, modelList) {
  const base = freshDocument(modelList);
  if (!data || typeof data !== "object") return base;
  if (Array.isArray(data.sliders)) {
    const sliders = [];
    const used = new Set(RESERVED);
    for (const s of data.sliders) {
      if (!s || typeof s !== "object") continue;
      const id = String(s.id || "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || used.has(id)) continue;
      used.add(id);
      const min = num(s.min, 0), max = num(s.max, 1);
      const lo = Math.min(min, max), hi = Math.max(min, max);
      sliders.push({
        id, label: String(s.label || id).slice(0, 40),
        min: lo, max: hi, value: clamp(num(s.value, 0), lo, hi),
        step: Math.max(1e-6, num(s.step, 0.01)),
      });
    }
    if (sliders.length) base.sliders = sliders;
  }
  if (data.line && typeof data.line === "object") {
    const L = data.line;
    base.line.enabled = !!L.enabled;
    if (modelList.some((m) => m.name === L.model)) base.line.model = L.model;
    base.line.count = clamp(Math.round(num(L.count, base.line.count)), 1, 24);
    base.line.spacing = num(L.spacing, base.line.spacing);
    base.line.axis = axisOk(L.axis, "x");
    base.line.sag = String(L.sag == null ? "sag" : L.sag);
    base.line.phaseStep = num(L.phaseStep, 0);
    if (Array.isArray(L.anchor) && L.anchor.length === 3) base.line.anchor = L.anchor.map((v) => num(v, 0));
  }
  if (data.rules && typeof data.rules === "object") {
    for (const m of modelList) {
      const r = data.rules[m.name];
      if (!r || typeof r !== "object") continue;
      if (Array.isArray(r.pivot) && r.pivot.length === 3 && r.pivot.every((v) => Number.isFinite(+v)))
        base.rules[m.name].pivot = r.pivot.map(Number);
      if (r.motion) base.rules[m.name].motion = sanitizeMotion(r.motion, modelList, m.name);
    }
  }
  return base;
}
function defaultMotion(type, self, modelList) {
  if (type === "spin") return { type, axis: "y", angle: "t" };
  if (type === "slide") return { type, axis: "x", distance: "lineSpeed * t" };
  if (type === "bob") return { type, channels: [defaultChannel()] };
  if (type === "follow") {
    const other = modelList.find((m) => m.name !== self);
    return { type, target: other ? other.name : "" };
  }
  if (type === "deform-rope") return { type, endA: "", endB: "", sag: "sag" };
  return { type: "none" };
}

//----- Page State -----||
let models = [];
let doc = freshDocument([]);
let t = 0;
let playing = false;
let speed = 1;
let scrubbing = false;
const openModels = new Set();
let gl, canvas, meshProg, skyProg, skyVao, U, SKY_U;
let viewW = 1, viewH = 1, viewProj = new Float32Array(16);
const cam = { yaw: 0.7, pitch: 0.45, dist: 8, target: [0, 0, 1] };
let gridBatch, cableBatch, pivotBatch, pivotLen = 0.3;
const IDENT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function $(id) { return document.getElementById(id); }
function setStatus(msg) { const n = $("status"); if (n) n.textContent = msg; }
function storeKey() { return "vert-modeler-preview:" + models.map((m) => m.name).slice().sort().join("|"); }
function readStore() {
  try { const raw = localStorage.getItem(storeKey()); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function saveStore() {
  if (!models.length) return;
  try { localStorage.setItem(storeKey(), JSON.stringify(doc)); } catch (e) { /* private mode */ }
}

//----- Draw -----||
function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function mat4LookAt(eye, target, up) {
  const z = norm(v3.sub(eye, target));
  const x = norm(v3.cross(up, z));
  const y = v3.cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1,
  ]);
}
function camEye() {
  const cp = Math.cos(cam.pitch);
  return v3.add(cam.target, v3.scale([cp * Math.sin(cam.yaw), -cp * Math.cos(cam.yaw), Math.sin(cam.pitch)], cam.dist));
}
function updateCamera() {
  const near = Math.max(0.02, Math.min(0.2, cam.dist * 0.01));
  const proj = mat4Perspective(FOV_Y, viewW / Math.max(1e-3, viewH), near, 400);
  viewProj = mat4Multiply(proj, mat4LookAt(camEye(), cam.target, [0, 0, 1]));
}
function modelMatrix(xf, shift) {
  const R = xf.R, p = xf.pivot, sh = shift || [0, 0, 0];
  const Rp = mul3(R, p);
  return new Float32Array([
    R[0], R[1], R[2], 0,
    R[3], R[4], R[5], 0,
    R[6], R[7], R[8], 0,
    p[0] + xf.T[0] + sh[0] - Rp[0], p[1] + xf.T[1] + sh[1] - Rp[1], p[2] + xf.T[2] + sh[2] - Rp[2], 1,
  ]);
}
function makeBatch(mode) {
  const vao = gl.createVertexArray(), vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, vbo, count: 0, mode };
}
function uploadBatch(batch, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.DYNAMIC_DRAW);
  batch.count = (data.length) / 6;
}
function drawBatch(batch) {
  if (!batch.count) return;
  gl.bindVertexArray(batch.vao);
  gl.drawArrays(batch.mode, 0, batch.count);
}
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function makeProgram(vs, fs) {
  const p = gl.createProgram();
  const a = compile(gl.VERTEX_SHADER, vs), b = compile(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, a); gl.attachShader(p, b);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.deleteShader(a); gl.deleteShader(b);
  return p;
}
function sceneBox() {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const addp = (p) => { for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; } };
  for (const m of models) for (let i = 0; i < m.count; i++) addp([m.rest[i * 6], m.rest[i * 6 + 1], m.rest[i * 6 + 2]]);
  if (!Number.isFinite(lo[0])) return { lo: [-1, -1, 0], hi: [1, 1, 1] };
  if (doc.line.enabled && doc.line.count > 1) {
    const shift = v3.scale(axisVec(doc.line.axis), doc.line.spacing * (doc.line.count - 1));
    addp(v3.add(lo, shift)); addp(v3.add(hi, shift));
  }
  return { lo, hi };
}
function rebuildGrid() {
  const box = models.length ? sceneBox() : { lo: [-4, -4, 0], hi: [4, 4, 0] };
  let E = 4;
  for (let k = 0; k < 3; k++) E = Math.max(E, Math.abs(box.lo[k]), Math.abs(box.hi[k]));
  E = Math.min(48, Math.ceil(E + 1));
  const step = E > 14 ? 1 : 0.5;
  const data = [], g = [0.24, 0.25, 0.31];
  for (let x = -E; x <= E + 1e-6; x += step) {
    const c = Math.abs(x) < 1e-6 ? [0.35, 0.8, 0.4] : g;
    data.push(x, -E, 0, ...c, x, E, 0, ...c);
  }
  for (let y = -E; y <= E + 1e-6; y += step) {
    const c = Math.abs(y) < 1e-6 ? [0.9, 0.3, 0.3] : g;
    data.push(-E, y, 0, ...c, E, y, 0, ...c);
  }
  uploadBatch(gridBatch, data);
}
function fitView() {
  const { lo, hi } = sceneBox();
  cam.target = lo.map((v, k) => (v + hi[k]) / 2);
  const radius = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  cam.dist = Math.max(1.5, (radius * 1.7) / Math.tan(FOV_Y / 2));
  pivotLen = Math.max(0.15, radius * 0.08);
}
function attachGpu(list) {
  for (const m of list) {
    const vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.rest, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    m.vao = vao; m.vbo = vbo; m.mode = "rigid";
  }
}
function dropGpu() {
  if (!gl) return;
  for (const m of models) {
    if (m.vbo) gl.deleteBuffer(m.vbo);
    if (m.vao) gl.deleteVertexArray(m.vao);
  }
}
function copyTransform(name, i, env, base) {
  const motion = doc.rules[name].motion;
  if (motion.type === "bob") return rigidBody(doc.rules[name], motion, env, doc.line.phaseStep * i);
  return base.get(name);
}
function anchorAt(xf, shift) {
  return v3.add(v3.add(v3.add(mul3(xf.R, doc.line.anchor), xf.pivot), xf.T), shift);
}
function pushTri(data, a, b, c, col) {
  data.push(a[0], a[1], a[2], ...col, b[0], b[1], b[2], ...col, c[0], c[1], c[2], ...col);
}
function buildCables(env, xf) {
  const name = doc.line.model;
  if (!name || !doc.rules[name] || doc.line.count < 2) return [];
  const sag = evalExpr(doc.line.sag, env);
  const axis = axisVec(doc.line.axis);
  const col = [0.62, 0.42, 0.28];
  const data = [];
  const ends = [];
  for (let i = 0; i < doc.line.count; i++) {
    const shift = v3.scale(axis, doc.line.spacing * i);
    ends.push(anchorAt(copyTransform(name, i, env, xf), shift));
  }
  for (let i = 0; i < ends.length - 1; i++) {
    const A = ends[i], B = ends[i + 1];
    if (v3.len(v3.sub(A, B)) < 1e-3) continue;
    const segs = 16, radius = 0.02, frames = [];
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const p = curvePoint(A, B, u, sag);
      frames.push({ p, ...frameFromTangent(curveTangent(A, B, u, sag)) });
    }
    const ring = (f, k) => {
      const ang = k / 3 * Math.PI * 2;
      return v3.add(f.p, v3.add(v3.scale(f.N, Math.cos(ang) * radius), v3.scale(f.B, Math.sin(ang) * radius)));
    };
    for (let s = 0; s < segs; s++) for (let k = 0; k < 3; k++) {
      const a = ring(frames[s], k), b = ring(frames[s], k + 1);
      const c = ring(frames[s + 1], k), d = ring(frames[s + 1], k + 1);
      pushTri(data, a, c, b, col);
      pushTri(data, b, c, d, col);
    }
  }
  return data;
}
function buildPivots(xf) {
  const data = [];
  const colors = [[0.95, 0.3, 0.3], [0.35, 0.85, 0.4], [0.35, 0.55, 1]];
  for (const name of openModels) {
    if (!xf.has(name) || !doc.rules[name]) continue;
    const origin = livePoint(doc.rules[name].pivot, name, xf);
    const R = xf.get(name).R;
    for (let a = 0; a < 3; a++) {
      const dir = [0, 0, 0]; dir[a] = pivotLen;
      const q = v3.add(origin, mul3(R, dir));
      data.push(origin[0], origin[1], origin[2], ...colors[a], q[0], q[1], q[2], ...colors[a]);
    }
  }
  return data;
}
function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  viewW = Math.max(1, r.width); viewH = Math.max(1, r.height);
}
function drawSky() {
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  gl.bindVertexArray(skyVao);
  gl.uniform3f(SKY_U.top, SKY_TOP[0], SKY_TOP[1], SKY_TOP[2]);
  gl.uniform3f(SKY_U.hor, SKY_HOR[0], SKY_HOR[1], SKY_HOR[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function draw() {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawSky();
  if (!models.length) return;
  updateCamera();
  const env = makeEnv(doc, t);
  const xf = computeTransforms(models, doc.rules, env);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(meshProg);
  gl.uniformMatrix4fv(U.vp, false, viewProj);
  gl.disable(gl.CULL_FACE);
  gl.uniformMatrix4fv(U.model, false, IDENT4);
  drawBatch(gridBatch);
  gl.enable(gl.CULL_FACE);
  for (const m of models) {
    const motion = doc.rules[m.name] ? doc.rules[m.name].motion : { type: "none" };
    const rope = motion.type === "deform-rope";
    if (rope) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, deformRope(m, motion, xf, env), gl.DYNAMIC_DRAW);
      m.mode = "rope";
      gl.uniformMatrix4fv(U.model, false, IDENT4);
    } else {
      if (m.mode !== "rigid") {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, m.rest, gl.DYNAMIC_DRAW);
        m.mode = "rigid";
      }
      gl.uniformMatrix4fv(U.model, false, modelMatrix(xf.get(m.name)));
    }
    gl.bindVertexArray(m.vao);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    if (!rope && doc.line.enabled && doc.line.model === m.name && doc.line.count > 1) {
      for (let i = 1; i < doc.line.count; i++) {
        const shift = v3.scale(axisVec(doc.line.axis), doc.line.spacing * i);
        gl.uniformMatrix4fv(U.model, false, modelMatrix(copyTransform(m.name, i, env, xf), shift));
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      }
    }
  }
  const cables = buildCables(env, xf);
  if (cables.length) {
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(U.model, false, IDENT4);
    uploadBatch(cableBatch, cables);
    drawBatch(cableBatch);
  }
  const axes = buildPivots(xf);
  if (axes.length) {
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(U.model, false, IDENT4);
    uploadBatch(pivotBatch, axes);
    drawBatch(pivotBatch);
  }
}

//----- Camera -----||
// One finger orbits. Two fingers: pinch zooms, the midpoint pans.
// A mouse drag orbits, the wheel zooms, right-drag or shift-drag pans.
const pointers = new Map();
let gesture = null;
function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function orbitBy(dx, dy) {
  cam.yaw -= dx * 0.01;
  cam.pitch = clamp(cam.pitch + dy * 0.01, -1.45, 1.45);
}
function zoomBy(factor) { cam.dist = clamp(cam.dist * factor, 0.3, 200); }
function panBy(dx, dy) {
  const eye = camEye();
  const fwd = norm(v3.sub(cam.target, eye));
  const right = norm(v3.cross(fwd, [0, 0, 1]));
  const up = v3.cross(right, fwd);
  const k = 2 * cam.dist * Math.tan(FOV_Y / 2) / viewH;
  cam.target = v3.add(cam.target, v3.add(v3.scale(right, -dx * k), v3.scale(up, dy * k)));
}
function bindCamera() {
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localPos(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
      return;
    }
    const p = localPos(e);
    const pan = e.pointerType === "mouse" && (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey));
    gesture = { kind: pan ? "pan" : "orbit", x: p.x, y: p.y, t0: performance.now() };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = localPos(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (d > 0 && gesture.dist > 0) zoomBy(gesture.dist / d);
      panBy(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      gesture.dist = d; gesture.mid = mid;
      return;
    }
    const dx = p.x - gesture.x, dy = p.y - gesture.y;
    if (gesture.kind === "pan") panBy(dx, dy);
    else orbitBy(dx, dy);
    gesture.x = p.x; gesture.y = p.y;
    gesture.moved = gesture.moved || Math.hypot(dx, dy) > 3;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (gesture && gesture.kind === "pinch") { gesture = pointers.size ? { kind: "idle" } : null; return; }
    if (pointers.size) return;
    if (gesture && gesture.kind === "orbit" && !gesture.moved && performance.now() - gesture.t0 < 280) {
      const now = performance.now();
      if (gesture.t0 - (end.last || 0) < 320) { fitView(); end.last = 0; }
      else end.last = gesture.t0;
    }
    gesture = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

//----- Panel -----||
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids || []) if (c) n.append(c);
  return n;
}
function fld(label, node) {
  return el("label", { class: "fld" }, [el("span", { text: label }), node]);
}
function numInput(k, value, step, extra) {
  const n = el("input", { type: "number", step: String(step), "data-k": k, value: String(roundish(value)) });
  if (extra) for (const [a, b] of Object.entries(extra)) n.dataset[a] = b;
  return n;
}
function textInput(k, value, extra) {
  const n = el("input", { type: "text", "data-k": k, value: value, spellcheck: "false", autocomplete: "off" });
  if (extra) for (const [a, b] of Object.entries(extra)) n.dataset[a] = b;
  const c = compileExpr(value);
  if (!c.ok) { n.classList.add("bad"); n.title = c.error; }
  return n;
}
function roundish(v) { return Math.round(v * 1e6) / 1e6; }
function axisOptions(current) {
  const opts = [["x", "X"], ["y", "Y"], ["z", "Z"]];
  if (Array.isArray(current)) opts.push([JSON.stringify(current), current.map((n) => roundish(n)).join(", ")]);
  return opts;
}
function readAxis(v) {
  if (v === "x" || v === "y" || v === "z") return v;
  try { const a = JSON.parse(v); if (Array.isArray(a) && a.length === 3) return a.map(Number); } catch (e) { /* keep fallback */ }
  return "z";
}
function selectEl(k, value, options, extra) {
  const s = el("select", { "data-k": k });
  if (extra) for (const [a, b] of Object.entries(extra)) s.dataset[a] = b;
  for (const [val, label] of options) s.append(el("option", { value: val, text: label }));
  s.value = Array.isArray(value) ? JSON.stringify(value) : String(value);
  return s;
}
function motionLabel(motion) {
  if (!motion) return "none";
  if (motion.type === "follow") return "follow " + (motion.target || "—");
  if (motion.type === "deform-rope") return "rope";
  return motion.type;
}
function renderSliders() {
  const root = $("sliders");
  root.textContent = "";
  doc.sliders.forEach((s, i) => {
    const range = el("input", { type: "range", "data-k": "slider-value", "data-i": String(i), min: String(s.min), max: String(s.max), step: String(s.step), value: String(s.value) });
    const out = el("output", { text: s.value.toFixed(3) });
    const box = el("div", { class: "card" }, [
      el("div", { class: "sHead" }, [
        el("input", { type: "text", "data-k": "slider-label", "data-i": String(i), value: s.label }),
        el("button", { type: "button", "data-k": "del-slider", "data-i": String(i), text: "×" }),
      ]),
      el("div", { class: "sRow" }, [range, out]),
      el("div", { class: "sMeta" }, [
        el("label", { text: "id" }, [el("input", { type: "text", "data-k": "slider-id", "data-i": String(i), value: s.id, spellcheck: "false" })]),
        el("label", { text: "min" }, [el("input", { type: "number", "data-k": "slider-min", "data-i": String(i), value: String(s.min), step: "0.01" })]),
        el("label", { text: "max" }, [el("input", { type: "number", "data-k": "slider-max", "data-i": String(i), value: String(s.max), step: "0.01" })]),
      ]),
    ]);
    root.append(box);
  });
}
function modelOptions(self, fixedLabel) {
  const opts = [[ "", fixedLabel ]];
  for (const m of models) if (m.name !== self) opts.push([m.name, m.name]);
  return opts;
}
function renderLine() {
  const root = $("line");
  root.textContent = "";
  const L = doc.line;
  const enabled = el("input", { type: "checkbox", "data-k": "line-enabled" });
  enabled.checked = !!L.enabled;
  root.append(el("label", { class: "chk" }, [enabled, document.createTextNode("Draw copies and sagging cables")]));
  root.append(fld("Model", selectEl("line-model", L.model, models.length ? models.map((m) => [m.name, m.name]) : [["", "—"]])));
  root.append(fld("Count", numInput("line-count", L.count, 1)));
  root.append(fld("Spacing", numInput("line-spacing", L.spacing, 0.1)));
  root.append(fld("Axis", selectEl("line-axis", L.axis, axisOptions(L.axis))));
  root.append(fld("Sag", textInput("line-sag", L.sag)));
  root.append(fld("Phase step", numInput("line-phase", L.phaseStep, 0.05)));
  root.append(el("p", { class: "note", text: "Phase step (radians) is added to each copy's bob. Mid-cable drop = sag × spacing." }));
  root.append(fld("Anchor X", numInput("line-anchor", L.anchor[0], 0.01, { axis: "0" })));
  root.append(fld("Anchor Y", numInput("line-anchor", L.anchor[1], 0.01, { axis: "1" })));
  root.append(fld("Anchor Z", numInput("line-anchor", L.anchor[2], 0.01, { axis: "2" })));
  root.append(el("p", { class: "note", text: "Anchor is the cable's leaving point, as an offset from the pivot." }));
  root.append(el("button", { type: "button", "data-k": "anchor-rope", text: "Anchor from rope end" }));
  $("lineSum").textContent = L.enabled ? "Line between copies — on" : "Line between copies";
}
function renderModels() {
  const root = $("models");
  root.textContent = "";
  for (const m of models) {
    const rule = doc.rules[m.name];
    const motion = rule.motion;
    const det = el("details", { "data-model": m.name });
    if (openModels.has(m.name)) det.open = true;
    det.append(el("summary", { text: m.name + " — " + motionLabel(motion) }));
    const body = el("div");
    body.append(fld("Motion", selectEl("motion", motion.type, [
      ["none", "None"], ["spin", "Spin"], ["bob", "Bob"], ["slide", "Slide"],
      ["follow", "Follow"], ["deform-rope", "Deform rope"],
    ], { model: m.name })));
    body.append(fld("Pivot X", numInput("pivot", rule.pivot[0], 0.01, { model: m.name, axis: "0" })));
    body.append(fld("Pivot Y", numInput("pivot", rule.pivot[1], 0.01, { model: m.name, axis: "1" })));
    body.append(fld("Pivot Z", numInput("pivot", rule.pivot[2], 0.01, { model: m.name, axis: "2" })));
    body.append(el("button", { type: "button", "data-k": "pivot-reset", "data-model": m.name, text: "Pivot = placed at" }));
    if (motion.type === "spin") {
      body.append(fld("Axis", selectEl("spin-axis", motion.axis, axisOptions(motion.axis), { model: m.name })));
      body.append(el("div", { class: "wide" }, [textInput("spin-angle", motion.angle, { model: m.name })]));
      body.append(el("p", { class: "note", text: "Angle in radians. lineSpeed / radius * t ties the spin to the line. pingpong(lineSpeed * t, lineSpan) / radius reverses with the buckets." }));
    } else if (motion.type === "slide") {
      body.append(fld("Axis", selectEl("slide-axis", motion.axis, axisOptions(motion.axis), { model: m.name })));
      body.append(el("div", { class: "wide" }, [textInput("slide-distance", motion.distance, { model: m.name })]));
      body.append(el("p", { class: "note", text: "Distance in world units, added along the axis. lineSpeed * t travels at the line speed." }));
    } else if (motion.type === "bob") {
      motion.channels.forEach((ch, i) => {
        const extra = { model: m.name, i: String(i) };
        const box = el("div", { class: "chan" });
        box.append(fld("Axis", selectEl("bob-axis", ch.axis, axisOptions(ch.axis), extra)));
        box.append(fld("Amplitude", numInput("bob-amp", ch.amplitude, 0.005, extra)));
        box.append(fld("Period", numInput("bob-period", ch.period, 0.1, extra)));
        box.append(fld("Phase", numInput("bob-phase", ch.phase, 0.05, extra)));
        box.append(fld("Amount", textInput("bob-amount", ch.amount, extra)));
        box.append(el("button", { type: "button", "data-k": "del-channel", "data-model": m.name, "data-i": String(i), text: "Remove axis" }));
        body.append(box);
      });
      body.append(el("p", { class: "note", text: "Offset = amplitude × amount × sin(2π t / period + phase). Amount is an expression, usually a slider such as wind." }));
      if (motion.channels.length < 4) body.append(el("button", { type: "button", "data-k": "add-channel", "data-model": m.name, text: "+ axis" }));
    } else if (motion.type === "follow") {
      body.append(fld("Target", selectEl("follow-target", motion.target, modelOptions(m.name, "—"), { model: m.name })));
      body.append(el("p", { class: "note", text: "Rides the target's translation and rotation, about the target's pivot." }));
    } else if (motion.type === "deform-rope") {
      body.append(fld("End A", selectEl("rope-a", motion.endA, modelOptions(m.name, "Fixed"), { model: m.name })));
      body.append(fld("End B", selectEl("rope-b", motion.endB, modelOptions(m.name, "Fixed"), { model: m.name })));
      body.append(fld("Sag", textInput("rope-sag", motion.sag, { model: m.name })));
      body.append(el("p", { class: "note", text: "End A is the end toward the negative long axis. Coiled ends stay on the part they wrap. The span hangs by sag × length at mid-span." }));
    }
    det.append(body);
    root.append(det);
  }
}
function renderAll() { renderSliders(); renderLine(); renderModels(); }
function refreshChrome() {
  $("preset").hidden = !isExample(models);
  $("play").textContent = playing ? "Pause" : "Play";
  const n = models.reduce((s, m) => s + m.count, 0);
  $("hudInfo").textContent = models.length ? models.length + " models · " + n + " verts" : "";
  $("msg").classList.toggle("hide", models.length > 0);
  $("lineSum").textContent = doc.line.enabled ? "Line between copies — on" : "Line between copies";
}
function loadHeaders(texts) {
  const parsed = parseScene(texts.join("\n"));
  if (!parsed.models.length) { setStatus("Couldn't read a model. " + (parsed.errors[0] || "")); return; }
  const key = "vert-modeler-preview:" + parsed.models.map((m) => m.name).slice().sort().join("|");
  let saved = null;
  try { const raw = localStorage.getItem(key); saved = raw ? JSON.parse(raw) : null; }
  catch (e) { saved = null; }
  dropGpu();
  models = parsed.models;
  for (const m of models) m._rope = undefined;
  const skipped = parsed.errors.length ? " Skipped: " + parsed.errors[0] : "";
  if (saved) { doc = sanitize(saved, models); setStatus(models.length + " models. Restored saved rules." + skipped); }
  else if (isExample(models)) { doc = exampleDocument(models); setStatus(models.length + " models. Example preset." + skipped); }
  else { doc = freshDocument(models); setStatus(models.length + " models. Each part is still." + skipped); }
  openModels.clear();
  t = 0;
  attachGpu(models);
  cam.yaw = 0.7; cam.pitch = 0.45;
  rebuildGrid();
  fitView();
  renderAll();
  saveStore();
  playing = true;
  refreshChrome();
}
function onPanelInput(e) {
  const tEl = e.target;
  const k = tEl.dataset.k;
  if (!k) return;
  const name = tEl.dataset.model;
  const rule = name ? doc.rules[name] : null;
  const motion = rule && rule.motion;
  const i = tEl.dataset.i != null ? +tEl.dataset.i : -1;
  if (k === "slider-value") {
    const s = doc.sliders[i];
    s.value = clamp(num(tEl.value, s.value), s.min, s.max);
    const out = tEl.parentElement.querySelector("output");
    if (out) out.textContent = s.value.toFixed(3);
  } else if (k === "slider-label") {
    doc.sliders[i].label = tEl.value.slice(0, 40);
  } else if (k === "slider-id") {
    if (e.type !== "change") return;
    const id = tEl.value.trim();
    const used = new Set(doc.sliders.map((s, n) => n === i ? "" : s.id));
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !RESERVED.has(id) && !used.has(id)) doc.sliders[i].id = id;
    else tEl.value = doc.sliders[i].id;
  } else if (k === "slider-min" || k === "slider-max") {
    if (e.type !== "change") return;
    const s = doc.sliders[i];
    if (k === "slider-min") s.min = num(tEl.value, s.min);
    else s.max = num(tEl.value, s.max);
    if (s.min > s.max) { const tmp = s.min; s.min = s.max; s.max = tmp; }
    s.value = clamp(s.value, s.min, s.max);
    renderSliders();
  } else if (k === "line-enabled") {
    doc.line.enabled = tEl.checked;
    rebuildGrid();
    $("lineSum").textContent = doc.line.enabled ? "Line between copies — on" : "Line between copies";
  } else if (k === "line-model") doc.line.model = tEl.value;
  else if (k === "line-count") doc.line.count = clamp(Math.round(num(tEl.value, doc.line.count)), 1, 24);
  else if (k === "line-spacing") { doc.line.spacing = num(tEl.value, doc.line.spacing); rebuildGrid(); }
  else if (k === "line-axis") doc.line.axis = readAxis(tEl.value);
  else if (k === "line-sag") { doc.line.sag = tEl.value; markExpr(tEl); }
  else if (k === "line-phase") doc.line.phaseStep = num(tEl.value, 0);
  else if (k === "line-anchor") doc.line.anchor[+tEl.dataset.axis] = num(tEl.value, 0);
  else if (k === "motion" && e.type === "change") {
    rule.motion = defaultMotion(tEl.value, name, models);
    if (rule.motion.type === "deform-rope") prepareRope(models.find((m) => m.name === name));
    renderModels();
  } else if (k === "pivot") rule.pivot[+tEl.dataset.axis] = num(tEl.value, rule.pivot[+tEl.dataset.axis]);
  else if (k === "spin-axis") motion.axis = readAxis(tEl.value);
  else if (k === "spin-angle") { motion.angle = tEl.value; markExpr(tEl); }
  else if (k === "slide-axis") motion.axis = readAxis(tEl.value);
  else if (k === "slide-distance") { motion.distance = tEl.value; markExpr(tEl); }
  else if (k === "follow-target") motion.target = tEl.value;
  else if (k === "rope-a") motion.endA = tEl.value;
  else if (k === "rope-b") motion.endB = tEl.value;
  else if (k === "rope-sag") { motion.sag = tEl.value; markExpr(tEl); }
  else if (k === "bob-axis") motion.channels[i].axis = readAxis(tEl.value);
  else if (k === "bob-amp") motion.channels[i].amplitude = num(tEl.value, 0);
  else if (k === "bob-period") motion.channels[i].period = Math.max(0.05, num(tEl.value, 1));
  else if (k === "bob-phase") motion.channels[i].phase = num(tEl.value, 0);
  else if (k === "bob-amount") { motion.channels[i].amount = tEl.value; markExpr(tEl); }
  else return;
  saveStore();
}
function markExpr(input) {
  const c = compileExpr(input.value);
  input.classList.toggle("bad", !c.ok);
  input.title = c.ok ? "" : c.error;
}
function onPanelClick(e) {
  const b = e.target.closest("[data-k]");
  if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
  const k = b.dataset.k;
  const name = b.dataset.model;
  if (k === "del-slider") {
    doc.sliders.splice(+b.dataset.i, 1);
    renderSliders();
  } else if (k === "pivot-reset") {
    const m = models.find((x) => x.name === name);
    if (m) doc.rules[name].pivot = m.placed.slice();
    renderModels();
  } else if (k === "add-channel") {
    const motion = doc.rules[name].motion;
    const used = new Set(motion.channels.map((c) => c.axis));
    const axis = ["z", "y", "x"].find((a) => !used.has(a)) || "y";
    motion.channels.push({ axis, amplitude: axis === "z" ? 0.05 : 0.02, period: 3.2, phase: 0.6, amount: "1" });
    renderModels();
  } else if (k === "del-channel") {
    doc.rules[name].motion.channels.splice(+b.dataset.i, 1);
    renderModels();
  } else if (k === "anchor-rope") {
    let hit = false;
    for (const m of models) {
      const motion = doc.rules[m.name].motion;
      if (motion.type !== "deform-rope") continue;
      const bind = prepareRope(m);
      if (!bind) continue;
      const ends = [motion.endA, motion.endB];
      for (let i = 0; i < 2; i++) if (ends[i] && ends[i] === doc.line.model) {
        doc.line.anchor = v3.sub(bind.endPoint[i], doc.rules[doc.line.model].pivot).map((v) => roundish(v));
        hit = true;
      }
    }
    if (hit) renderLine();
    else setStatus("No rope end is attached to the line's model.");
  } else return;
  saveStore();
}
function downloadJSON() {
  const blob = new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "anim-rules.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
async function loadRulesFile(file) {
  if (!models.length) { setStatus("Open a scene .h first."); return; }
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (e) { setStatus("That file isn't JSON."); return; }
  doc = sanitize(data, models);
  renderAll();
  refreshChrome();
  saveStore();
  setStatus("Loaded rules.");
}

//----- Boot -----||
function boot() {
  canvas = $("gl");
  gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!gl) { $("msg").textContent = "WebGL 2 is not available."; return; }
  gl.clearColor(SKY_TOP[0], SKY_TOP[1], SKY_TOP[2], 1);
  gl.enable(gl.DEPTH_TEST);
  gl.cullFace(gl.BACK);
  meshProg = makeProgram(`#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}`, `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`);
  U = { vp: gl.getUniformLocation(meshProg, "uViewProj"), model: gl.getUniformLocation(meshProg, "uModel") };
  skyProg = makeProgram(`#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out float vY;
void main() {
  vec2 p = P[gl_VertexID];
  vY = p.y * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`, `#version 300 es
precision mediump float;
in float vY;
uniform vec3 uTop;
uniform vec3 uHorizon;
out vec4 fragColor;
void main() { fragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 1.0, vY)), 1.0); }`);
  SKY_U = { top: gl.getUniformLocation(skyProg, "uTop"), hor: gl.getUniformLocation(skyProg, "uHorizon") };
  skyVao = gl.createVertexArray();
  gridBatch = makeBatch(gl.LINES);
  cableBatch = makeBatch(gl.TRIANGLES);
  pivotBatch = makeBatch(gl.LINES);
  rebuildGrid();
  bindCamera();
  new ResizeObserver(() => resize()).observe(canvas);

  $("open").addEventListener("click", () => $("fileH").click());
  $("fileH").addEventListener("change", async () => {
    const files = [...$("fileH").files];
    $("fileH").value = "";
    if (!files.length) return;
    const texts = [];
    for (const f of files) texts.push(await f.text());
    loadHeaders(texts);
  });
  $("play").addEventListener("click", () => { playing = !playing; refreshChrome(); });
  $("fit").addEventListener("click", () => fitView());
  $("saveJson").addEventListener("click", downloadJSON);
  $("loadJson").addEventListener("click", () => $("fileJson").click());
  $("fileJson").addEventListener("change", async () => {
    const f = $("fileJson").files[0];
    $("fileJson").value = "";
    if (f) await loadRulesFile(f);
  });
  $("preset").addEventListener("click", () => {
    if (!isExample(models)) return;
    for (const m of models) m._rope = undefined;
    doc = exampleDocument(models);
    renderAll();
    refreshChrome();
    saveStore();
    setStatus("Example preset.");
  });
  $("addSlider").addEventListener("click", () => {
    let n = 1;
    const ids = new Set(doc.sliders.map((s) => s.id));
    while (ids.has("v" + n)) n++;
    doc.sliders.push({ id: "v" + n, label: "Value " + n, min: 0, max: 1, value: 0, step: 0.01 });
    renderSliders();
    saveStore();
  });
  $("timeRange").addEventListener("pointerdown", () => { scrubbing = true; });
  $("timeRange").addEventListener("pointerup", () => { scrubbing = false; });
  $("timeRange").addEventListener("pointercancel", () => { scrubbing = false; });
  $("timeRange").addEventListener("input", () => {
    t = num($("timeRange").value, t);
    $("timeOut").textContent = t.toFixed(2);
  });
  $("speed").addEventListener("input", () => { speed = num($("speed").value, 1); });
  $("panel").addEventListener("input", onPanelInput);
  $("panel").addEventListener("change", onPanelInput);
  $("panel").addEventListener("click", onPanelClick);
  $("models").addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.model) return;
    if (d.open) openModels.add(d.dataset.model);
    else openModels.delete(d.dataset.model);
  }, true);
  window.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); playing = !playing; refreshChrome(); }
    else if (e.key === "f" || e.key === "F") fitView();
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && /\.json$/i.test(files[0].name)) { await loadRulesFile(files[0]); return; }
    const texts = [];
    for (const f of files) texts.push(await f.text());
    loadHeaders(texts);
  });
  renderAll();
  refreshChrome();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) t += dt * speed;
    if (!scrubbing && $("timeRange")) {
      const range = $("timeRange");
      if (t > +range.max - 1) range.max = String(Math.ceil(t + 30));
      range.value = String(Math.min(+range.max, t));
      $("timeOut").textContent = t.toFixed(2);
    }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (typeof document !== "undefined") boot();
})();
