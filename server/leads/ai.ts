import { aiInferenceSchema, type AiInference } from "@shared/leadContracts";

const inferenceSchema = {
  type: "object",
  properties: {
    industry: { type: ["string", "null"] },
    services: { type: "array", items: { type: "string" }, maxItems: 12 },
    websiteQualitySignals: { type: "array", items: { type: "string" }, maxItems: 12 },
    opportunityTags: { type: "array", items: { type: "string" }, maxItems: 12 },
    rationale: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["industry", "services", "websiteQualitySignals", "opportunityTags", "rationale", "confidence"],
  additionalProperties: false,
};

export async function inferLeadIntelligence(evidenceText: string): Promise<{ model: string; inference: AiInference }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  if (!apiKey) throw new Error("AI inference is not configured. Set GEMINI_API_KEY before running AI enrichment.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are an evidence-bound business analyst. Extract only what the supplied website evidence supports. Do not invent contacts, ownership, revenue, or facts not in the evidence. Every classification is an AI inference, not source verification." }] },
      contents: [{ role: "user", parts: [{ text: `Analyze this retrieved business website evidence and produce the required JSON.\n\nEVIDENCE:\n${evidenceText.slice(0, 12000)}` }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: inferenceSchema, temperature: 0.1 },
    }),
  });
  const data = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message ?? `Gemini inference failed with ${response.status}`);
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Gemini did not return structured inference content.");
  return { model, inference: aiInferenceSchema.parse(JSON.parse(content)) };
}
