import { planLeadChatRequest } from "../../Gbolix-api-current/artifacts/api-server/src/lib/leadsAiPlanner.ts";
import {
  toConfirmedChatDiscoveryRequest,
  toLeadRequestBody,
} from "../../Gbolix-api-current/artifacts/gbolix/src/lib/leadChatProposal.ts";
import { openStreetMapPilotAdapter } from "../server/leads/adapters.ts";

const customerMessage = "Find 5 restaurants in Lagos that may need a new website and automation.";

// The planner's external Gemini transport is mocked locally because deployment and
// its server-only API key are unavailable. The production planner code is still
// called with the exact customer message and its structured response is validated.
const mockedPlannerResponse = {
  kind: "proposal",
  reply: "I can search for up to 5 restaurant businesses in Lagos. I will reserve at most 5 workspace credits, and only qualified new leads will consume credits. Review and confirm to run this limited OpenStreetMap search.",
  categoryCode: "restaurants",
  city: "Lagos",
  desiredLeadCount: 5,
  label: "Lagos restaurants needing website and automation outreach",
  keywords: ["website", "automation"],
};

async function planWithMockedTransport(message, response) {
  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "local-simulation-only";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://generativelanguage.googleapis.com/")) {
      throw new Error(`Unexpected planner request: ${url}`);
    }
    const request = JSON.parse(String(init?.body ?? "{}"));
    const prompt = request?.contents?.[0]?.parts?.[0]?.text;
    if (!String(prompt).includes(message)) {
      throw new Error("The customer message was not supplied to the planner.");
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    return await planLeadChatRequest(message);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
}

const proposal = await planWithMockedTransport(customerMessage, mockedPlannerResponse);
const incompleteCustomerMessage = "I need some restaurant leads.";
const clarificationProposal = await planWithMockedTransport(incompleteCustomerMessage, {
  kind: "clarify",
  reply: "Which city and how many restaurant leads would you like?",
  categoryCode: "restaurants",
  city: null,
  desiredLeadCount: null,
  label: null,
  keywords: [],
});
const clarificationRequest = toConfirmedChatDiscoveryRequest(clarificationProposal);
if (clarificationRequest !== null) {
  throw new Error("An incomplete customer prompt incorrectly produced a dispatchable request.");
}

const confirmedRequest = toConfirmedChatDiscoveryRequest(proposal);

if (!confirmedRequest) {
  throw new Error("The simulated customer proposal was not safe to confirm.");
}

const requestBody = toLeadRequestBody(confirmedRequest);
const discovery = await openStreetMapPilotAdapter.discover({
  categoryCode: confirmedRequest.categoryCode,
  cities: [confirmedRequest.city],
  limit: confirmedRequest.desiredLeadCount,
  keywords: confirmedRequest.keywords,
});

const summary = {
  mode: "local-safe-simulation",
  customerMessage,
  planner: {
    implementation: "planLeadChatRequest",
    transport: "mocked Gemini structured-response transport",
    productionSecretUsed: false,
  },
  proposal,
  confirmation: {
    required: true,
    confirmed: true,
    requestBody,
  },
  clarificationScenario: {
    customerMessage: incompleteCustomerMessage,
    proposal: clarificationProposal,
    confirmableRequest: clarificationRequest,
    dispatchable: false,
  },
  discovery: {
    adapterKey: discovery.adapterKey,
    requestedMaximum: confirmedRequest.desiredLeadCount,
    returnedRecords: discovery.records.length,
    leads: discovery.records.map((lead, index) => ({
      businessName: lead.businessName,
      category: lead.categoryCode,
      city: lead.city,
      website: lead.website ?? null,
      phone: lead.phone ?? null,
      provenance: discovery.provenance[index]?.sourceUrl ?? null,
    })),
  },
  safeguards: {
    walletTouched: false,
    storageTouched: false,
    productionDatabaseTouched: false,
    maximumDiscoveryCandidates: 25,
    maximumRequestedForThisSimulation: 5,
  },
};

console.log(JSON.stringify(summary, null, 2));
