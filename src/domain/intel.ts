import { createHash } from "node:crypto";
import { z } from "zod";

export const IntelTypeSchema = z.enum(["tender", "major_case"]);
export type IntelType = z.infer<typeof IntelTypeSchema>;

export const ServiceTypeSchema = z.enum([
  "general_counsel",
  "special_project",
  "litigation",
  "other",
]);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;

export const CaseClassSchema = z.enum([
  "guiding",
  "gazette",
  "reference",
  "public_impact",
]);
export type CaseClass = z.infer<typeof CaseClassSchema>;

export const LawFirmAngleSchema = z.enum(["marketing", "precedent", "risk"]);
export type LawFirmAngle = z.infer<typeof LawFirmAngleSchema>;

export const VerificationStatusSchema = z.enum([
  "pending",
  "verified",
  "failed",
  "needs_review",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const CheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});
export type Check = z.infer<typeof CheckSchema>;

export const VerificationSchema = z.object({
  status: VerificationStatusSchema,
  checks: z.array(CheckSchema),
});
export type Verification = z.infer<typeof VerificationSchema>;

const SharedFields = {
  id: z.string().min(8),
  sourceId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().min(2),
  publishedAt: z.string().min(4),
  ingestedAt: z.string().min(4),
  region: z.string().min(1),
  rawText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  verification: VerificationSchema,
};

export const TenderSchema = z.object({
  ...SharedFields,
  type: z.literal("tender"),
  purchaser: z.string().min(1),
  projectName: z.string().min(1),
  budget: z.number().nullable(),
  budgetText: z.string().nullable(),
  serviceType: ServiceTypeSchema,
  qualification: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  bidOpenAt: z.string().nullable(),
  contact: z.string().nullable(),
  biddable: z.boolean(),
});
export type Tender = z.infer<typeof TenderSchema>;

export const MajorCaseSchema = z.object({
  ...SharedFields,
  type: z.literal("major_case"),
  caseClass: CaseClassSchema,
  court: z.string().nullable(),
  summary: z.string().min(8),
  issues: z.array(z.string()),
  statutes: z.array(z.string()),
  holding: z.string().nullable(),
  stage: z.string().nullable(),
  lawFirmAngles: z.array(LawFirmAngleSchema),
  briefMarkdown: z.string().min(8),
});
export type MajorCase = z.infer<typeof MajorCaseSchema>;

export const IntelItemSchema = z.discriminatedUnion("type", [
  TenderSchema,
  MajorCaseSchema,
]);
export type IntelItem = z.infer<typeof IntelItemSchema>;

export function intelId(sourceId: string, sourceUrl: string): string {
  return createHash("sha256")
    .update(`${sourceId}\n${sourceUrl}`)
    .digest("hex")
    .slice(0, 24);
}

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function isBiddable(item: Pick<Tender, "deadlineAt" | "verification">, at = new Date()): boolean {
  if (item.verification.status === "failed") return false;
  if (!item.deadlineAt) return false;
  const deadline = Date.parse(item.deadlineAt);
  if (Number.isNaN(deadline)) return false;
  return deadline > at.getTime();
}

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  general_counsel: "常年法律顾问",
  special_project: "专项法律服务",
  litigation: "诉讼仲裁",
  other: "其他法律服务",
};

export const CASE_CLASS_LABEL: Record<CaseClass, string> = {
  guiding: "指导性案例",
  gazette: "公报案例",
  reference: "参考性案例",
  public_impact: "社会重大影响案件",
};
