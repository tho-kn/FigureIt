import type { ImportOptions, ImportOutcome } from "./types";

export type { ImportOptions, ImportOutcome, ImportedAsset } from "./types";

export type ImportKind = "pptx" | "pdf";
export const MAX_IMPORT_FILE_BYTES = 50_000_000;

/** Maps a file name to the importer that can handle it, or undefined when unsupported. */
export const detectImportKind = (fileName: string): ImportKind | undefined => {
  if (/\.pptx$/i.test(fileName)) return "pptx";
  if (/\.pdf$/i.test(fileName)) return "pdf";
  return undefined;
};

/**
 * Converts a PPTX or PDF document into scene insert operations and embedded assets.
 * Pure conversion only: callers own asset persistence and scene transactions.
 * Importers load lazily so their heavyweight dependencies never enter the
 * application module graph unless an import actually runs.
 */
export const importFile = async (file: File, options: ImportOptions): Promise<ImportOutcome> => {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("file_too_large");
  const kind = detectImportKind(file.name);
  if (kind === "pptx") return (await import("./pptx")).importPptx(file, options);
  if (kind === "pdf") return (await import("./pdf")).importPdf(file, options);
  throw new Error("unsupported_import");
};
