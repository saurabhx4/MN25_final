/** Canonical MN25 domain API contract used by generated/handwritten clients. */
export const canonicalDomainOpenApi = {
  paths: {
    '/api/domain/analyses/{id}/provenance': { get: { summary: 'Trace an analysis to its model, datasets, geometry and results' } },
    '/api/domain/predictions/{id}/provenance': { get: { summary: 'Trace a prediction to its exact model and dataset versions' } },
    '/api/domain/organizations/me/graph': { get: { summary: 'Return the authenticated organization domain graph' } },
  },
};
