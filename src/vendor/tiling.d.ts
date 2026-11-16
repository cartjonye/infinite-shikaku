export type Square = [number, number, number];
export const N: number;
export const UNIQUE: number;
export const TOTAL: number;
export const ALPHABET: string;
export const ORDER: number[];
export function orient(squares: Square[], k: number): Square[];
export function fnv1a(str: string): number;
export function parseSeed(v: unknown): number;
export function validate(squares: Square[], n?: number): boolean;
export interface Tiler {
  decode(id: number): Square[];
  layout(seed: number | string): Square[];
  randomLayout(rand?: () => number): { seed: number; squares: Square[] };
}
export function createTiler(packed: string): Tiler;
