# Vert_Modeler

A mobile low-poly model editor, live at https://nhsoule.github.io/Vert_Modeler/.
It exports tiny C++ headers (12-byte `Vert`s) for a game engine. It's one file (`index.html`) with no build step.
**Anim** (top right of the view) and **Preview** in the Scene panel open the [animation preview](preview.html).

## Scenes (v18)

A scene holds several named objects. You can build a small environment to get a feel for a place, then export single models from it.

- **Object mode** (the **Object** button in the second row, or **Tab**):
  - Tap an object to make it active and add it to the selection. Tap the active one again to drop it. Tap empty space to keep only the active object. Double-tap empty space for a clean preview.
  - The gizmo moves the selected objects. The scale and rotate icons in the readout bar switch it to scaling or rotating.
  - Tap X/Y/Z in the readout to type a value.
  - **# snap** snaps to 0.125 units, 15° and ×0.125 steps.
  - Scale and rotate are baked into the vertices. The position is the object's pivot.
- **Edit mode** (Move/Split/Paint/Select…): this edits the active object only. The other objects are drawn dimmed. Turn that off with **Dim others**.
- **Scene panel** (the **Scene** button):
  - The object list: tap a name to make that object active, **✓** to add it to the selection, **◉** to hide it.
  - Add: **+ Cube**, **+ Plane ↑** (standing), **+ Plane ▭** (flat).
  - **Duplicate**, **Copy**, **Paste**.
  - **Combine** joins the selected objects into the active one, with transforms baked.
    Where two shapes overlap, only the one that passes through is changed. The other
    stays exactly as it was. **Combine**, under the buttons, is **Slide & trim**
    (pull buried corners out along their own edges, then drop faces that end up
    hidden) or **Delete hidden faces** (move nothing; drop a face only when it lies
    entirely inside the other shape). A corner that cannot slide without leaving a
    gap or a notch stays put. **Which shape** chooses who changes: Auto, the active
    object, or the other objects. A shape that isn't a closed shell never does the
    trimming. Undo takes it back with the join.
  - **Separate** moves the selected faces into a new object. **Faces → new** copies them into a new object.
  - **Two-sided**, **Subdivide**, **Rename**, **Delete**, **Hide**.
  - **Save .json** / **Open…** for a project file, and **New scene**.
- **Shortcuts:**
  - Ctrl+C / Ctrl+V: copy and paste objects, or faces while editing (the clipboard survives a reload).
  - Ctrl+D: duplicate. Ctrl+J: combine.
  - P: separate faces. H: hide. Delete: delete objects in Object mode.
  - Ctrl+Z / Ctrl+Shift+Z: undo and redo across every scene action.
- **Planes:** one quad, two-sided by default, so they work for grass, leaves and signs. Subdivide splits them.
- **Autosave:** the whole scene is saved in the browser. `examples/diorama.json` is a sample scene: a ground tile, trees and rocks.

## Shapes drawer (v22)

- All the primitives live in their own **Shapes** drawer: open **Scene** and tap the gold
  **＋ Shapes** tab in its header (or press **Shift+A**); **☰ Scene** switches back, × closes.
- Tiles: **Cube**, **Plane ↑** (standing), **Plane ▭** (ground), **Prism** and **Pyramid**.
  The chips under Prism and Pyramid pick the shape / number of sides (remembered); tapping
  a tile adds that shape at the view centre as the active object. The drawer stays open so
  you can add several.

## Pyramids (v22)

- **Pyramid** with 3, 4 (default), 5, 6, 8, 12 or 16 sides (12 and 16 read as a cone).
- Fewest triangles: the base is a fan of N - 2 plus N sides, so **2N - 2 triangles** and
  N + 1 verts (4 sides = 6 triangles / 18 export verts; 3 = 4, 6 = 10, 8 = 14, 16 = 30).
- Base on z = 0, 1 unit wide in X (a 4-sided one is a 1 x 1 square), apex 1 unit up,
  mirrored on X. Edits like any mesh.

## Prisms (v21)

- **Prism** (Shapes drawer) adds a prism with the fewest triangles; the chips set the
  shape (remembered):
  - **▲ Roof, 3 sides** (default): 6 verts, **8 triangles** (2 cap tris + 3 quad sides),
    so the export is 8 triangles / 24 verts.
  - **◣ Ramp wedge**: a right-angle wedge, also 8 triangles (no mirror).
  - **4, 5, 6 or 8 sides**: 2(N-2) + 2N triangles (6 sides = 20).
- The cross-section faces the Front view and runs 1 unit along Y, flat on z = 0. It edits
  like any mesh (move, extrude, split, paint...).
- Dragging a vertex exactly onto a neighbour it shares an edge with (use snap or type the
  value) now merges the two, and the triangles that lost their area go away. So pulling a
  cube's top-front corners onto the back ones gives a clean 6-vert / 8-tri wedge instead of
  12 triangles with 4 zero-area slivers.
- The export also skips any triangle that is still zero-area (three corners on a line) and
  notes `// N zero-area triangles skipped`; normal models export byte-for-byte as before.

## Lighting presets (v23)

The Shade menu (☀) has three named lighting presets. **Pastel Day** is the default.

| Preset | Ambient (r,g,b) | Sun (r,g,b) | Sky top → horizon |
|---|---|---|---|
| Pastel Day | 0.56, 0.52, 0.70 (lavender) | 0.44, 0.42, 0.16 (warm) | soft blue → blush pink |
| Dusk | 0.40, 0.32, 0.58 | 0.60, 0.44, 0.22 | deep violet → rose |
| Classic | 0.55 (grey) | 0.45 (white) | the old flat grey look |

- **Sky** switches between the gradient background and the old dark background.
- **Fog** fades distant faces toward the horizon colour. It only affects the viewport and is never exported.
- Every preset keeps ambient + sun ≤ 1 per channel, so a fully lit face never clips.

**Export bakes the preset that's showing** into the vertex colours, per channel:

    baked = rgb * (ambient + sun * max(0, n · L))   clamped to 1

The header comment states the exact formula and preset. For example:

    // lighting baked into colors (rgb * ((0.56,0.52,0.70) + (0.44,0.42,0.16)*max(0, n.(0.3,0.5,0.8))), clamped to 1, preset Pastel Day)

Classic exports are byte-for-byte the same as before (`0.55 + 0.45*max(0, n.(...))`).

**Import** reads that line back and un-bakes each face with the matching preset and sun. It then snaps to the palette colour that re-bakes to the same bytes. A Pastel export therefore re-imports to the exact palette colours, whatever preset the viewport is showing. Files without a preset line are treated as Classic.

## Biome filters (v24)

The **◑** button under the view buttons (F B L R T D I) opens a list of biome screen filters. The active biome's name is always shown under the button. The choice is remembered, and switching fades over about 0.7 s, to preview how the game blends between biomes (2–3 s there).

A biome filter is a **viewport preview only**. It never touches the bake, so exports are byte-for-byte the same with any biome on.

It is the last step of the fragment shader, after fog:

    c = mix(c, c * tint, strength);
    c = clamp(mix(luma(c), c, saturation) * brightness, 0, 1);   // luma = dot(c, (0.2126, 0.7152, 0.0722))

- **Fog:** fades toward the biome's fog colour, with `fogDensity` as its maximum strength. 0.6 is the normal fog; denser fog also starts closer. None uses the sky's horizon colour, so it looks exactly like the plain lighting preset.
- **Sky:** hazes toward the fog colour too.
- **Works with the other view settings:** the lighting presets, the Sky/Fog toggles and the colour preview all combine with it. The Fog toggle turns biome fog off as well.
- **Copying the numbers:** the menu shows the selected biome's numbers as JSON, with a **Copy values** button. The whole table is `BIOME_FILTERS` in index.html and [examples/biome_filters.json](examples/biome_filters.json).

| Biome | Tint (r, g, b) | Strength | Saturation | Brightness | Fog (r, g, b) | Fog density |
|---|---|---|---|---|---|---|
| None | 1.00, 1.00, 1.00 | 0.00 | 1.00 | 1.00 | sky horizon | 0.60 |
| Meadow | 0.96, 1.00, 0.78 | 0.12 | 1.08 | 1.03 | 0.90, 0.95, 0.80 | 0.45 |
| Forest | 0.70, 0.92, 0.72 | 0.20 | 0.95 | 0.94 | 0.56, 0.72, 0.60 | 0.65 |
| Swamp | 0.66, 0.74, 0.46 | 0.25 | 0.78 | 0.90 | 0.46, 0.54, 0.36 | 0.90 |
| Desert | 1.00, 0.82, 0.64 | 0.20 | 1.15 | 1.05 | 0.98, 0.86, 0.70 | 0.50 |
| Snow | 0.84, 0.92, 1.00 | 0.20 | 0.85 | 1.08 | 0.90, 0.94, 1.00 | 0.70 |
| Cave | 0.56, 0.62, 0.90 | 0.25 | 0.80 | 0.72 | 0.10, 0.11, 0.22 | 0.80 |
| Volcanic | 1.00, 0.56, 0.40 | 0.22 | 1.10 | 0.92 | 0.42, 0.18, 0.16 | 0.70 |
| Beach | 0.82, 0.98, 1.00 | 0.12 | 1.10 | 1.06 | 0.86, 0.95, 0.98 | 0.40 |
| Crystal | 0.82, 0.68, 1.00 | 0.20 | 1.12 | 1.02 | 0.72, 0.62, 0.96 | 0.60 |

## World palette (v23)

A built-in, read-only **World (named)** palette of 36 colours. Every swatch shows its name, and the rows are grouped by material. Most groups run light / mid / dark.

- **Choosing colours you can't tell apart by eye:**
  - The readout above the swatches always names the brush (`Brush: Leaf · Foliage`).
  - It also names the last face you painted, picked or hovered.
  - A colour that isn't in the palette reads as the nearest name, e.g. `≈ Leaf`.
- **Pick:** tap Pick, then a face. It takes that face's colour as the brush and doesn't paint.
- **Colour preview** (in the Shade menu) cycles through four views of the viewport and palette: Normal, Greys (value only), Deutan and Protan. It simulates how the scene reads with each kind of colour vision.
- **Designed for colorblind viewers:**
  - The shades inside a group step clearly in lightness.
  - Groups are separated by blue/yellow and lightness as well as red/green, so they stay distinguishable for deutan and protan viewers.
- **Your own palettes:** Duplicate makes an editable copy, with a name field per swatch. C++ palette export writes `// #hex Name [Group]` comments, and palette import reads them back.
- **Data:** the full table is `WORLD_TABLE` in index.html. It is also in [examples/world_palette.json](examples/world_palette.json).

| Group | Light | Mid | Dark |
|---|---|---|---|
| Foliage | Leaf Light `#bee478` (190, 228, 120) | Leaf `#70b454` (112, 180, 84) | Leaf Dark `#205c4a` (32, 92, 74) |
| Grass | Grass Light `#84dcac` (132, 220, 172) | Grass Teal `#3caa98` (60, 170, 152) | Grass Deep `#1c5c70` (28, 92, 112) |
| Ground | Sand `#f8e2a8` (248, 226, 168) | Path `#c49468` (196, 148, 104) | Dirt `#70484a` (112, 72, 74) |
| Warm Rock | Warm Stone Light `#eeded2` (238, 222, 210) | Warm Stone `#a68e8c` (166, 142, 140) | Warm Stone Dark `#605064` (96, 80, 100) |
| Cool Rock | Cool Stone Light `#c4cce8` (196, 204, 232) | Cool Stone `#7884b0` (120, 132, 176) | Cool Stone Dark `#424674` (66, 70, 116) |
| Wood | Wood Light `#f0c086` (240, 192, 134) | Wood `#c08054` (192, 128, 84) | Wood Dark `#58343e` (88, 52, 62) |
| Water | Water Light `#b0f0fa` (176, 240, 250) | Water `#50a6e0` (80, 166, 224) | Water Deep `#2c54a6` (44, 84, 166) |
| Mushroom | Cream `#fcf0d6` (252, 240, 214)<br>Gill Pink `#e2b2b0` (226, 178, 176)<br>Cap Pink `#f6808a` (246, 128, 138)<br>Cap Red `#dc3e54` (220, 62, 84)<br>Cap Red Dark `#962448` (150, 36, 72) | | |
| Blossom | Blossom Pink `#ffbad8` (255, 186, 216) | Petal Rose `#f07ab6` (240, 122, 182) | Berry Plum `#843884` (132, 56, 132) |
| Glow | Glow Yellow `#fff082` (255, 240, 130) | Crystal Cyan `#5adcd6` (90, 220, 214) | Crystal Violet `#a074f0` (160, 116, 240) |
| Roof | Roof Coral `#fa987e` (250, 152, 126)<br>Roof Slate `#545a98` (84, 90, 152) | | |
| Sky & Misc | Sky Blue `#aad0fc` (170, 208, 252)<br>Ink `#28223e` (40, 34, 62) | | |

## Edge density (v25)

A small readout under the model stats, on the active object:

- **edges avg · min · max** — the average edge length, the shortest, and the longest, in world units. Each edge is counted once (a shared edge is not counted twice). A quad's diagonal counts too, because it is an edge of the triangles, so a unit cube reads min 1 and max √2.
- The lengths use the same recovery as the export, `world = offset + position × scale`, so a 1-unit edge reads as 1 on every model and the numbers can be compared.
- **sel avg · min · max** — the same numbers for the edges that run between the selected vertices, when two or more vertices are selected. `sel —` means those vertices share no edge.
- **Mark** (remembered) draws edges that are under half or over double the average as **thick bright** lines. It is one neutral colour, only brighter and thicker than the wireframe. The readout says `thick bright = under ½ or over 2× avg` while it is on. The button reads **Marked**.

## Size references

The **Rock** button cycles through four states: off (**Ref**), **Rock**, rock + player (**Both**), **Player**, then back to off. The button label shows the state, the setting is remembered, and the references show in every mode.

- The rock is the game's smallest rock, about 1.05 × 1.06 × 0.40 units.
- The player is a blocky mannequin 1.80 tall, with its eyes at 1.70. It faces -Y (the Front view) and stands at (2.25, 0, 0), beside the rock.
- **Moving them:** in Object mode, tap the rock or the player. It turns yellow and gets the gizmo.
  - Drag a handle to move it. ⌗ snap applies.
  - Tap X/Y/Z in the readout to type a position.
  - The ↻ chip turns it about Z, so the player can face another way.
  - Tap an object or empty space to go back to the objects.
  - Each reference moves on its own. Hidden references ignore taps.
  - Positions are remembered in the browser, not in the scene .json or undo.
  - **Scene → Reset refs** puts both back at their start spots.
- Both are display only: they are never selected, edited, combined, saved in the scene or exported.
- Nothing in the code defines units in metres, so the player assumes 1 unit = 1 m.

## Export / import

- **Export → Export:** one of three choices.
  - *This object*: named after the object.
  - *Each selected, separate*: one header per object.
  - *All merged*: one model in scene coordinates, named after the scene.
  - **Download .h** saves one file per model.
- An object exports in its own coordinates about its pivot. The header notes `placed at (x, y, z)` when the pivot isn't the origin.
- **Two-sided** faces export twice: the second half of the array repeats every triangle reversed (0,2,1) with its normal flipped, so the triangle and vertex counts double. It works with back-face culling on and needs no engine flag.
- **Import:**
  - **Add** puts each pasted or opened model in as a new object, in real units, at its `placed at` spot. Several headers in one paste or several files are fine.
  - **Replace** swaps the active object's mesh.
  - A file whose triangles all come in reversed pairs comes back as one two-sided object.
  - Old 9-float and v17 headers still import.
- The `Vert` format didn't change: int16 position normalized to -1..1 around the bounds centre, a 2-byte octahedral normal, RGBA8, 12 bytes, no padding. `name_offset[3]` and `name_scale` recover world units. **Shade** decides whether lighting is baked into the colours.

## Animation preview

[preview.html](preview.html) plays an exported scene header without leaving the browser. Open a `.h` (several models in one file is fine; you can also drop it on the page). Colours are the baked bytes from the file. One finger orbits, a pinch zooms, two fingers pan. A mouse drag orbits, the wheel zooms, and right-drag pans. Double-tap the view to fit. The rules sit in a scrolling panel under the view (beside it on a wide screen), and the sliders are sized for a thumb.

Each model has one motion. The pivot starts as the file's `placed at` point, and you can type another. **Bob** can stack axes, so a part can rise and fall and sway sideways at the same time. **Spin** and **slide** take a math expression. **Follow** rides another model's translation and rotation, about that model's pivot. **Deform rope** rebuilds the free span of a line each frame and leaves a coiled end stuck to whichever model it wraps.

Three sliders start on the page: `lineSpeed`, `wind`, and `sag`. **Line between copies** duplicates one model N times along an axis and draws a cable between each pair. The cable's mid-point drop is `sag × spacing`. **Example preset** fills in a setup when the file contains Bucket, Bucket_ore, Guide_Axle_1, Guide_Axle_2, Stanchion, Balloon, Stake, and Rope: the stanchion and balloon bob, the stake stays put, the rope deforms between the stake and the stanchion, the axles spin with the line, and both buckets travel the line.

**Save JSON** downloads the rules. **Load JSON** reads them back. The page also stores them in the browser, one set for each list of model names, and restores that set the next time you open the same file.

A vertex in the file is back in world units as:

```
world = placed + offset + (pos / 32767) * scale
```

`placed` is the pivot from `placed at (x, y, z)`. `offset` and `scale` are that model's `NAME_offset` and `NAME_scale`.

### Rules JSON

`version` is 1. `sliders` are the named drivers. `line` is the row of copies. `rules` is one entry per model name.

```json
{
  "version": 1,
  "sliders": [
    { "id": "lineSpeed", "label": "Line speed", "min": -2, "max": 2, "value": 0.8, "step": 0.01 },
    { "id": "wind", "label": "Wind / bob", "min": 0, "max": 2, "value": 1, "step": 0.01 },
    { "id": "sag", "label": "Sag", "min": 0, "max": 0.5, "value": 0.14, "step": 0.005 }
  ],
  "line": {
    "enabled": true,
    "model": "Stanchion",
    "count": 4,
    "spacing": 3,
    "axis": "x",
    "sag": "sag",
    "phaseStep": 0,
    "anchor": [0.00204, -0.008969, -0.436317]
  },
  "rules": {
    "Stanchion": {
      "pivot": [-3.078, 0.045, 2.566],
      "motion": {
        "type": "bob",
        "channels": [
          { "axis": "z", "amplitude": 0.07, "period": 2.8, "phase": 0, "amount": "wind" },
          { "axis": "y", "amplitude": 0.02, "period": 3.6, "phase": 0, "amount": "wind" }
        ]
      }
    },
    "Balloon": { "pivot": [-3.072, 0.375, 3.875], "motion": { "type": "follow", "target": "Stanchion" } },
    "Stake": { "pivot": [-4.129, -1.073, 0.070], "motion": { "type": "none" } },
    "Rope": {
      "pivot": [-3.624, -0.540, 1.116],
      "motion": { "type": "deform-rope", "endA": "Stake", "endB": "Stanchion", "sag": "sag" }
    },
    "Guide_Axle_1": {
      "pivot": [-3.453, 0.043, 2.510],
      "motion": { "type": "spin", "axis": "y", "angle": "pingpong(lineSpeed * t, lineSpan) / 0.195" }
    },
    "Bucket": {
      "pivot": [-3.349, -0.274, 2.012],
      "motion": { "type": "slide", "axis": "x", "distance": "pingpong(lineSpeed * t, lineSpan)" }
    }
  }
}
```

- **bob.** Each channel adds `axis * amplitude * amount * sin(2π t / period + phase)`. `amount` is an expression (often a slider). `period` is seconds, `phase` is radians, `amplitude` is world units. Several channels combine.
- **spin.** `angle` is radians about `axis` through the pivot. A steady rate is `2 * t` (2 rad/s). `lineSpeed / 0.195 * t` uses a slider and a radius. The same distance the buckets travel, divided by the radius, keeps the axle matched to the line, including when that distance turns around.
- **slide.** `distance` is world units added along `axis`.
- **follow.** `target` is another model. This model's vertices take that target's translation and rotation about the target's pivot.
- **deform-rope.** `endA` and `endB` are a model name, or `""` to leave that end where the file put it. `sag` is an expression. End A is the end toward the negative long axis of the rope (the principal direction of its vertices, flipped so the largest component is positive).
- **none.** The model stays where the file put it.
- **axis** is `"x"`, `"y"`, `"z"`, or a 3-number array. Z is up.
- **line.anchor** is the point a cable leaves the duplicated model, as an offset from its pivot. `phaseStep` (radians) is added to each copy's bob. `count` includes the original. Copies are spaced along `axis`.
- **lineSpan**, available inside expressions, is `spacing * (count - 1)`.

Expressions use `t` (seconds), `pi`, `lineSpan`, and the slider ids. The operators are `+ - * /` and parentheses. Functions: `sin`, `cos`, `tan`, `abs`, `sqrt`, `floor`, `min`, `max`, `pow`, `mod`, `clamp(x, a, b)`, and `pingpong(x, length)` (0 up to `length`, then back to 0). Slider ids `t`, `pi`, and `lineSpan` are reserved.

The sagging curve between ends A and B, with `s` from 0 to 1 and `L = |B - A|`:

```
sagDir = normalize( (0,0,-1) - chord * dot((0,0,-1), chord) )
P(s) = A + (B - A) * s + sagDir * sag * L * 4 * s * (1 - s)
```

`chord` is `(B - A) / L`. The middle drops by `sag * L`. If the chord is vertical, the drop is toward -Y. The same curve is used for the rope span and for the cables between copies.

On a rope, a coiled end is the fat knot of vertices at that end. Those vertices keep their position relative to the end and move with the attached model's rigid motion. Every other vertex stores how far it sits along the rest centreline (`s`) and its offset from `P(s)` in the curve's frame (up, side, along the tangent). The frame's up is world Z, or world Y when the rope is nearly vertical. The offset is taken at the sag that best matches the file, so that sag redraws the rope as exported; other values hang it more or less.
