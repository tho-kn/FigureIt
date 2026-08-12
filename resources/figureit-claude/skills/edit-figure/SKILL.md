---
name: edit-figure
description: Edit a FigureIt scene by proposing supported object operations. Use for deleting, moving, resizing, rotating, renaming, regrouping, or restyling objects in the supplied scene.
---

# Edit a FigureIt scene

Treat the supplied scene snapshot as the complete working context. Never request files, paths, shell commands, credentials, or hidden application state.

Return a short explanation and the smallest set of supported operations that satisfies the request. Preserve stable object IDs, text, geometry, layer order, and styles unless the request requires changing them. Reference only IDs present in the scene.

Keep every proposal atomic. If the request requires unsupported TikZ or unavailable information, explain the limitation and return no operations. Never claim that a proposal was applied; FigureIt validates, previews, and asks the user to approve it.
