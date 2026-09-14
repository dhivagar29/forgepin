declare module "js-yaml" {
  export const JSON_SCHEMA: object;
  export function load(input: string, options?: {
    schema?: object;
    maxDepth?: number;
    listener?: (event: "open" | "close", state: { position: number; kind: string | null; result: unknown }) => void;
  }): unknown;
}
