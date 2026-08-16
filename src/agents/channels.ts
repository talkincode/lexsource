import type { AgentId } from "./catalog";
import type { SourceKind } from "../sources/types";

export type CollectionChannel = {
  id: string;
  name: string;
  kind: SourceKind;
  agentId: AgentId;
  region: string;
  seedUrls: string[];
  hints: string;
};

export const CHANNELS: CollectionChannel[] = [
  {
    id: "ccgp",
    name: "中国政府采购网",
    kind: "tender",
    agentId: "tender",
    region: "全国",
    seedUrls: ["https://www.ccgp.gov.cn/cggg/zygg/gkzb/"],
    hints: "政府采购公开招标列表。点进公告正文再判断标的；导航里出现「法律服务」不等于本页是法律服务采购。",
  },
  {
    id: "ggzy",
    name: "全国公共资源交易平台",
    kind: "tender",
    agentId: "tender",
    region: "全国",
    seedUrls: ["https://www.ggzy.gov.cn/"],
    hints: "公共资源交易聚合页。用链接文本判断是否值得打开，打开正文后再决定是否入库。",
  },
  {
    id: "spc-guiding",
    name: "最高人民法院指导性案例",
    kind: "major_case",
    agentId: "case",
    region: "全国",
    seedUrls: ["https://www.court.gov.cn/zixun/gengduo/16.html"],
    hints: "最高法公开指导性/典型案例列表。文书网可作为补充参考源。",
  },
  {
    id: "wenshu",
    name: "中国裁判文书网",
    kind: "major_case",
    agentId: "case",
    region: "全国",
    seedUrls: ["https://wenshu.court.gov.cn/"],
    hints: "仅作所内参考情报，低频访问。有登录墙时在设置里写入 Cookie，不要当自有判例库。",
  },
];

export function getChannel(id: string): CollectionChannel | undefined {
  return CHANNELS.find((channel) => channel.id === id);
}

export function channelsForAgent(agentId: AgentId): CollectionChannel[] {
  return CHANNELS.filter((channel) => channel.agentId === agentId);
}

export function listChannels(): CollectionChannel[] {
  return CHANNELS;
}
