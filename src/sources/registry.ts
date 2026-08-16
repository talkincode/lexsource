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
  Pick<SourceAdapter, "id" | "name" | "kind" | "region" | "description" | "seedUrl"> & {
    fetchable: boolean;
  }
> {
  return sourceRegistry.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.kind,
    region: source.region,
    description: source.description,
    seedUrl: source.seedUrl,
    fetchable: Boolean(source.seedUrl || source.discover),
  }));
}
