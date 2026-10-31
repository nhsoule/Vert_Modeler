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

## Prisms (v21)

- **+ Prism** (Scene panel, next to + Cube / + Plane) adds a prism with the fewest
  triangles; the picker beside it sets the shape (remembered):
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
