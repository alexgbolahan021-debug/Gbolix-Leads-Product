import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { parseDomainList, parseLeadCsv } from "../leads/csv";
import { getIntegrationSecret, verifyIntegrationSignature } from "../leads/integration";
import {
  createWorkspaceExport,
  authorizeWorkspaceExportDownload,
  enrichLeadFromWebsite,
  ensureEngineConfiguration,
  getLeadDetail,
  inferLeadFromEvidence,
  ingestUserLeads,
  listActiveCategories,
  listOperatorExports,
  listOperatorJobs,
  listOperatorLeads,
} from "../leadDb";
import { getAdapterCatalog } from "../leads/adapters";
import { enforceRateLimit } from "../leads/rateLimit";

const boundedContent = z.string().min(1).max(1_000_000);
const baseIngestionInput = z.object({
  label: z.string().trim().min(1).max(255),
  rawContent: boundedContent,
  categoryCode: z.string().trim().min(1).max(96).optional(),
  externalRequestId: z.string().trim().min(8).max(128),
  creditAuthorizationId: z.string().trim().min(6).max(128).optional(),
});

async function ingestForWorkspace(input: z.infer<typeof baseIngestionInput> & { inputType: "csv_upload" | "domain_list"; workspaceId: string; actorId?: string; customerId?: string }) {
  const parsed = input.inputType === "csv_upload" ? parseLeadCsv(input.rawContent) : parseDomainList(input.rawContent);
  const fieldMapping = input.inputType === "csv_upload" ? parseLeadCsv(input.rawContent).mapping : undefined;
  return ingestUserLeads({
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    actorId: input.actorId,
    externalRequestId: input.externalRequestId,
    creditAuthorizationId: input.creditAuthorizationId,
    label: input.label,
    inputType: input.inputType,
    rawContent: input.rawContent,
    fieldMapping,
    categoryCode: input.categoryCode,
    valid: parsed.valid,
    invalid: parsed.invalid,
  });
}

export const leadsRouter = router({
  bootstrap: protectedProcedure.query(async () => {
    await ensureEngineConfiguration();
    return { workspaceId: "gbolix-operator-mock", adapters: getAdapterCatalog(), categories: await listActiveCategories() };
  }),
  adapters: protectedProcedure.query(() => getAdapterCatalog()),
  list: protectedProcedure.query(async () => listOperatorLeads()),
  jobs: protectedProcedure.query(async () => listOperatorJobs()),
  exports: protectedProcedure.query(async () => listOperatorExports()),
  detail: protectedProcedure.input(z.object({ leadId: z.string().min(1).max(64) })).query(async ({ input }) => getLeadDetail(input.leadId)),
  ingestCsv: protectedProcedure.input(baseIngestionInput).mutation(async ({ ctx, input }) => {
    enforceRateLimit("operator_ingest", ctx.user.id.toString(), 12);
    return ingestForWorkspace({ ...input, inputType: "csv_upload", workspaceId: "gbolix-operator-mock", actorId: ctx.user.id.toString() });
  }),
  ingestDomains: protectedProcedure.input(baseIngestionInput).mutation(async ({ ctx, input }) => {
    enforceRateLimit("operator_ingest", ctx.user.id.toString(), 12);
    return ingestForWorkspace({ ...input, inputType: "domain_list", workspaceId: "gbolix-operator-mock", actorId: ctx.user.id.toString() });
  }),
  enrich: protectedProcedure.input(z.object({ leadId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => { enforceRateLimit("operator_enrich", ctx.user.id.toString(), 20); return enrichLeadFromWebsite({ leadId: input.leadId, actorId: ctx.user.id.toString() }); }),
  infer: protectedProcedure.input(z.object({ leadId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => { enforceRateLimit("operator_ai", ctx.user.id.toString(), 6); return inferLeadFromEvidence({ leadId: input.leadId, actorId: ctx.user.id.toString() }); }),
  exportSelected: protectedProcedure.input(z.object({ leadIds: z.array(z.string().min(1).max(64)).min(1).max(500), externalRequestId: z.string().trim().min(8).max(128) })).mutation(async ({ ctx, input }) => { enforceRateLimit("operator_export", ctx.user.id.toString(), 12); return createWorkspaceExport({ leadIds: input.leadIds, externalRequestId: input.externalRequestId, actorId: ctx.user.id.toString() }); }),
  authorizeExportDownload: protectedProcedure.input(z.object({ exportId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => { enforceRateLimit("operator_download", ctx.user.id.toString(), 30); return authorizeWorkspaceExportDownload({ exportId: input.exportId, actorId: ctx.user.id.toString() }); }),
  integration: router({
    // This is the Gbolix.site boundary. It is deliberately public at the tRPC transport layer but rejects any unsigned or stale request.
    ingestUserSource: publicProcedure.input(z.object({
      timestamp: z.string().datetime(),
      signature: z.string().length(64),
      payload: baseIngestionInput.extend({
        inputType: z.enum(["csv_upload", "domain_list"]),
        externalWorkspaceId: z.string().trim().min(1).max(128),
        externalCustomerId: z.string().trim().max(128).optional(),
        actorId: z.string().trim().max(128).optional(),
      }),
    })).mutation(async ({ input }) => {
      if (!verifyIntegrationSignature(getIntegrationSecret(), { timestamp: input.timestamp, payload: input.payload, signature: input.signature })) {
        throw new Error("Invalid or expired Gbolix integration signature.");
      }
      enforceRateLimit("gbolix_integration_ingest", input.payload.externalWorkspaceId, 12);
      return ingestForWorkspace({
        ...input.payload,
        workspaceId: input.payload.externalWorkspaceId,
        customerId: input.payload.externalCustomerId,
        actorId: input.payload.actorId,
      });
    }),
  }),
});
