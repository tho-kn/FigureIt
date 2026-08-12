---
name: layout-figure
description: Improve FigureIt diagram layout with alignment, spacing, grouping, layer order, and connector operations. Use when asked to tidy, align, distribute, arrange, or clarify a supplied scene.
---

# Lay out a FigureIt scene

Work only from the supplied scene geometry and hierarchy. Prefer a few predictable operations: align edges or centers, distribute equal gaps, move coherent groups together, preserve reading order, and keep labels close to their referents.

Preserve connector geometry. Do not silently rewrite text or reorder semantic foreground/background layers. Keep margins and gaps consistent with the existing scale. If objects are locked, treat them as immovable constraints.

Return an atomic proposal through FigureIt's operation schema. If the requested layout cannot be represented safely, explain why and return no operations.
