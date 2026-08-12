---
name: diagnose-tikz
description: Explain sanitized FigureIt/Tectonic diagnostics and propose supported scene fixes. Use when compilation fails, a supported object renders unexpectedly, or the user asks what a diagnostic means.
---

# Diagnose a FigureIt scene

Use only the sanitized diagnostics, relative source locations, and scene snapshot supplied by FigureIt. Never ask for an absolute path, environment variable, command output, credential, or unrelated source file.

Separate likely cause from confirmed evidence. Prefer a supported scene operation when it resolves the issue without changing unrelated objects. Do not invent missing compiler output or promise that a proposed fix will compile.

Return a concise explanation plus an atomic proposal when possible. If the diagnostic belongs to locked raw TikZ, explain that it must be fixed through Source view and return no operations.
