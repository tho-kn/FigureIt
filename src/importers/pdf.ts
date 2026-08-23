import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { SceneNode } from "../model";
import type { ImportOptions, ImportOutcome } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 10;
const MAX_ASSET_BYTES = 900_000;
const TARGET_PIXEL_WIDTH = 1600;

const r6 = (value: number) => Number(value.toFixed(6));

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));

export const importPdf = async (file: File, options: ImportOptions): Promise<ImportOutcome> => {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  try {
    const warnings: string[] = [];
    if (pdf.numPages > MAX_PAGES) warnings.push(`Imported the first ${MAX_PAGES} of ${pdf.numPages} pages`);
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);

    type RenderedPage = { name: string; bytes: Uint8Array; widthCm: number; heightCm: number };
    const pages: RenderedPage[] = [];
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await pdf.getPage(index);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.min(TARGET_PIXEL_WIDTH, Math.max(600, Math.round(baseViewport.width * 2)));
        const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas_unavailable");
        await page.render({ canvas, canvasContext: context, viewport }).promise;

        let blob = await canvasBlob(canvas, "image/png");
        let type = "png";
        for (const quality of [0.85, 0.6]) {
          if (blob && blob.size <= MAX_ASSET_BYTES) break;
          blob = await canvasBlob(canvas, "image/jpeg", quality);
          type = "jpg";
        }
        if (!blob || blob.size > MAX_ASSET_BYTES) {
          warnings.push(`Skipped page ${index}: rendered image exceeds the project asset size limit`);
          continue;
        }
        pages.push({
          name: `import-pdf-p${index}.${type}`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
          widthCm: baseViewport.width / 72 * 2.54,
          heightCm: baseViewport.height / 72 * 2.54,
        });
      } finally {
        page.cleanup();
      }
    }
    if (!pages.length) throw new Error("no_pages_rendered");

    const gapCm = 0.4;
    const marginCm = 0.25;
    const naturalWidth = pages.reduce((total, page) => total + page.widthCm, 0) + gapCm * (pages.length - 1);
    const maxHeight = Math.max(...pages.map((page) => page.heightCm));
    const fit = Math.min(1, options.targetWidthCm / naturalWidth, options.targetHeightCm / maxHeight);
    const scale = fit > 0 ? fit : 1;

    const nodes: SceneNode[] = [];
    let cursorX = 0;
    for (const page of pages) {
      const width = r6(page.widthCm * scale);
      const height = r6(page.heightCm * scale);
      nodes.push({
        id: crypto.randomUUID(),
        kind: "image",
        name: `PDF page ${pages.indexOf(page) + 1}`,
        visible: true,
        locked: false,
        transform: { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 },
        geometry: {
          x: r6(cursorX),
          y: r6(options.targetHeightCm - marginCm - height),
          width,
          height,
        },
        image: { href: page.name, width, height },
        prefix: "\n",
        source: "",
      });
      cursorX += width + gapCm * scale;
    }

    return {
      label: `Imported ${pages.length} page${pages.length === 1 ? "" : "s"} from ${file.name.replace(/\.pdf$/i, "")}`,
      operations: nodes.map((node) => ({ type: "insert" as const, node })),
      assets: pages.map(({ name, bytes }) => ({ name, bytes })),
      warnings: [...new Set(warnings)],
    };
  } finally {
    void loadingTask.destroy();
  }
};
