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
