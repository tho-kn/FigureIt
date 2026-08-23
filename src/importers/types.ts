import type { SceneOperation } from "../model";

export type ImportedAsset = { name: string; bytes: Uint8Array };

export type ImportOptions = {
  targetWidthCm: number;
  targetHeightCm: number;
};

export type ImportOutcome = {
  label: string;
  operations: SceneOperation[];
  assets: ImportedAsset[];
  warnings: string[];
};
