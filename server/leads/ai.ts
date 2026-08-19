import { aiInferenceSchema, type AiInference } from "@shared/leadContracts";
import { invokeLLM, listLLMModels } from "../_core/llm";

export async function inferLeadIntelligence(evidenceText: string): Promise<{ model: string; inference: AiInference }> {
  const { data: models } = await listLLMModels();
  const model = models.find(candidate => candidate.id === "gemini-3-flash-preview")?.id;
  if (!model) throw new Error("The configured Gemini structured-output model is not available.");
  const response = await invokeLLM({
    model,
    messages: [
      {
        role: "system",
        content: "You are an evidence-bound business analyst. Extract only what the supplied website evidence supports. Do not invent contacts, ownership, revenue, or facts not in the evidence. Classifications are inferences, not verification.",
      },
      {
        role: "user",
        content: `Analyze this retrieved business website evidence and produce the required JSON.\n\nEVIDENCE:\n${evidenceText.slice(0, 12000)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "gbolix_lead_intelligence",
        strict: true,
        schema: {
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
        },
      },
    },
  });
  const content = response.choices[0]?.message.content;
  if (!content || typeof content !== "string") throw new Error("The AI inference request did not return structured content.");
  return { model, inference: aiInferenceSchema.parse(JSON.parse(content)) };
}
