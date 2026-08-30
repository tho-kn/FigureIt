import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { SceneNode } from "../model";
import type { ImportOutcome } from "./types";
import { detectImportKind, importFile } from "./index";

const insertedNodes = (outcome: ImportOutcome): SceneNode[] =>
  outcome.operations.filter((operation) => operation.type === "insert").map((operation) => operation.node);

const blobPart = (bytes: Uint8Array): BlobPart => bytes as unknown as BlobPart;

vi.mock("pdfjs-dist", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 720 * scale, height: 540 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => undefined,
  };
  const pdf = { numPages: 2, getPage: async () => page };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => undefined }),
  };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/pdf-worker.js" }));

const slideXml = (shapes: string) => `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shapes}
  </p:spTree></p:cSld>
</p:sld>`;

const rectShape = `<p:sp>
  <p:nvSpPr><p:cNvPr name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="3600000" y="1800000"/><a:ext cx="3600000" cy="1800000"/></a:xfrm>
    <a:prstGeom prst="rect" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:avLst/></a:prstGeom>
    <a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="accent1"/></a:solidFill>
  </p:spPr>
  <p:txBody><a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:rPr b="1" sz="1800"/><a:t>Hello</a:t></a:r></a:p></p:txBody>
</p:sp>`;

const picShape = `<p:pic>
  <p:nvPicPr><p:cNvPr name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="rId1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:blipFill>
  <p:spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="7200000" y="720000"/><a:ext cx="1800000" cy="900000"/></a:xfrm><a:prstGeom prst="rect" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:spPr>
</p:pic>`;

const buildPptx = async (): Promise<Blob> => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/theme/theme1.xml", `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`);
  zip.file("ppt/slides/slide1.xml", slideXml(rectShape + picShape));
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>`);
  zip.file("ppt/media/image1.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Blob([blobPart(bytes)]);
};

describe("detectImportKind", () => {
  it("maps extensions to importers", () => {
    expect(detectImportKind("deck.pptx")).toBe("pptx");
    expect(detectImportKind("paper.PDF")).toBe("pdf");
    expect(detectImportKind("figure.tex")).toBeUndefined();
  });

  it("rejects oversized imports before reading them", async () => {
    const file = new File([new Uint8Array([1])], "large.pptx");
    Object.defineProperty(file, "size", { value: 50_000_001 });
    await expect(importFile(file, { targetWidthCm: 10, targetHeightCm: 10 })).rejects.toThrow("file_too_large");
  });
});

describe("pptx import", () => {
  const options = { targetWidthCm: 34, targetHeightCm: 19.05 };

  it("converts shapes, text, theme colors, and images into scene nodes", async () => {
    const outcome = await importFile(new File([await buildPptx()], "deck.pptx"), options);
    const [box, image] = insertedNodes(outcome);
    expect(box.kind).toBe("rect");
    expect(image?.kind).toBe("image");
    expect(box.name).toBe("Box");
    expect(box.text).toBe("Hello");
    expect(box.style?.fill).toBe("#4472C4");
    expect(box.style?.textStyle?.bold).toBe(true);
    expect(box.style?.textStyle?.fontSize).toBe(18);
    // Slide is 33.87 x 19.05cm; with a 34 x 19.05cm target the height binds so scale is 1.
    expect(box.geometry?.width ?? 0).toBeCloseTo(10, 3);

    expect(image?.image?.href).toMatch(/^slide1-media\d+\.png$/);
    expect(outcome.assets).toHaveLength(1);
    expect(outcome.assets[0].bytes.byteLength).toBe(8);
  });

  it("flips slide coordinates from top-left y-down to bottom-left y-up", async () => {
    const outcome = await importFile(new File([await buildPptx()], "deck.pptx"), options);
    const nodes = insertedNodes(outcome);
    const higherOnSlide = nodes.find((node) => node.name === "Logo")!;
    const lowerOnSlide = nodes.find((node) => node.name === "Box")!;
    expect(higherOnSlide.geometry!.y!).toBeGreaterThan(lowerOnSlide.geometry!.y!);
  });

  it("rejects files without slides", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p/>");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(importFile(new File([blobPart(bytes)], "empty.pptx"), options)).rejects.toThrow();
  });
});

describe("pdf import", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(64)], { type: "image/png" }));
    });
  });

  it("renders each page as an image node laid out left to right", async () => {
    const outcome = await importFile(new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf"), {
      targetWidthCm: 34,
      targetHeightCm: 20,
    });
    expect(outcome.assets.map((asset) => asset.name)).toEqual(["import-pdf-p1.png", "import-pdf-p2.png"]);
    const nodes = insertedNodes(outcome);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.kind === "image")).toBe(true);
    const [first, second] = nodes;
    expect(second.geometry!.x!).toBeGreaterThan(first.geometry!.x!);
    expect(first.geometry!.width).toBeCloseTo(25.4 * (34 / (25.4 * 2 + 0.4)), 3);
    expect(outcome.warnings).toHaveLength(0);
  });
});
