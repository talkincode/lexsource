import { CHANNELS, getChannel, type CollectionChannel } from "../agents/channels";
import { htmlToDocument } from "./page";
import { extractLinks } from "./page";
import type { SourceAdapter } from "./types";

export function getSource(id: string): SourceAdapter {
  const channel = getChannel(id);
  if (!channel) throw new Error(`Unknown source: ${id}`);
  return channelToAdapter(channel);
}

export function listSources(): Array<
  Pick<SourceAdapter, "id" | "name" | "kind" | "region" | "description" | "seedUrl"> & {
    fetchable: boolean;
  }
> {
  return CHANNELS.map((channel) => ({
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    region: channel.region,
    description: channel.hints,
    seedUrl: channel.seedUrls[0],
    fetchable: channel.seedUrls.length > 0,
  }));
}

function channelToAdapter(channel: CollectionChannel): SourceAdapter {
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    region: channel.region,
    description: channel.hints,
    seedUrl: channel.seedUrls[0],
    parse(input) {
      return htmlToDocument({ sourceId: channel.id, sourceUrl: input.sourceUrl, html: input.html, text: input.text });
    },
    discover(html, listingUrl) {
      return extractLinks(html, listingUrl).map((link) => link.url);
    },
  };
}
