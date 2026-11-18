import type {
  IntelligenceServiceHandler,
  ServerContext,
  SearchIntelHistoryRequest,
  SearchIntelHistoryResponse,
} from '../../../../contracts/generated/server/worldmonitor/intelligence/v1/service_server';
import { validateHistoryScope, validateHistoryText } from '../../../_shared/intel-history-contract';

/** Hard cap on `limit`, kept from the published contract. */
const MAX_LIMIT = 64;

/** Matches the proto's documented `max_len`. */
const MAX_QUERY_LEN = 500;

/**
 * SearchIntelHistory handler.
 *
 * The durable history store (Convex `intelHistory`) was removed with Convex,
 * and the Lite UI does not call this route. The request is still validated,
 * then the handler answers the documented store-outage shape:
 * `upstreamUnavailable: true` with no records, which the gateway serves as
 * no-store. No embeddings call is made.
 */
export const searchIntelHistory: IntelligenceServiceHandler['searchIntelHistory'] = async (
  _ctx: ServerContext,
  req: SearchIntelHistoryRequest,
): Promise<SearchIntelHistoryResponse> => {
  const query = validateHistoryText(req.query, 'query', 2, MAX_QUERY_LEN);
  validateHistoryScope(req, MAX_LIMIT);
  return { records: [], query, partial: false, upstreamUnavailable: true };
};
