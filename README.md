# Vert_Modeler

A mobile low-poly model editor, live at https://nhsoule.github.io/Vert_Modeler/.
It exports tiny C++ headers (12-byte `Vert`s) for a game engine. It's one file (`index.html`) with no build step.

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
