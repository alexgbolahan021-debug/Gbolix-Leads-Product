import { z } from "zod";

export const verificationStateSchema = z.enum([
  "verified",
  "partially_verified",
  "unverified",
  "conflicting",
  "unavailable",
]);

export const leadInputSchema = z.object({
  businessName: z.string().trim().min(1).max(320),
  website: z.string().trim().max(2048).optional().or(z.literal("")),
  email: z.string().trim().max(320).optional().or(z.literal("")),
  phone: z.string().trim().max(64).optional().or(z.literal("")),
  industry: z.string().trim().max(255).optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  country: z.string().trim().max(2).optional().or(z.literal("")),
  region: z.string().trim().max(128).optional().or(z.literal("")),
  city: z.string().trim().max(128).optional().or(z.literal("")),
  address: z.string().trim().max(1000).optional().or(z.literal("")),
  postalCode: z.string().trim().max(32).optional().or(z.literal("")),
  categoryCode: z.string().trim().max(96).optional().or(z.literal("")),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export const aiInferenceSchema = z.object({
  industry: z.string().max(255).nullable(),
  services: z.array(z.string().max(160)).max(12),
  websiteQualitySignals: z.array(z.string().max(200)).max(12),
  opportunityTags: z.array(z.string().max(120)).max(12),
  rationale: z.string().max(700),
  confidence: z.number().min(0).max(1),
});

export type AiInference = z.infer<typeof aiInferenceSchema>;

export const csvFieldAliases: Record<keyof LeadInput, string[]> = {
  businessName: ["business", "business name", "company", "company name", "name"],
  website: ["website", "url", "domain", "site"],
  email: ["email", "business email", "public email"],
  phone: ["phone", "telephone", "mobile", "business phone"],
  industry: ["industry", "sector", "vertical"],
  description: ["description", "about", "notes"],
  country: ["country"],
  region: ["region", "state", "province"],
  city: ["city", "town"],
  address: ["address", "street address"],
  postalCode: ["postal code", "postcode", "zip", "zip code"],
  categoryCode: ["category", "category code", "business category"],
};
