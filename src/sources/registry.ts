import { ccgpAdapter } from "./ccgp";
import { ggzyAdapter } from "./ggzy";
import { spcAdapter } from "./spc";
import type { SourceAdapter } from "./types";

export const sourceRegistry: SourceAdapter[] = [ccgpAdapter, ggzyAdapter, spcAdapter];

export function getSource(id: string): SourceAdapter {
  const found = sourceRegistry.find((source) => source.id === id);
  if (!found) throw new Error(`Unknown source: ${id}`);
  return found;
}

export function listSources(): Array<
  Pick<SourceAdapter, "id" | "name" | "kind" | "region" | "description">
> {
  return sourceRegistry.map(({ id, name, kind, region, description }) => ({
    id,
    name,
    kind,
    region,
    description,
  }));
}
