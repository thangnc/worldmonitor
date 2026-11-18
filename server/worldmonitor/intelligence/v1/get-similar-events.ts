import type {
  IntelligenceServiceHandler,
  ServerContext,
  GetSimilarEventsRequest,
  GetSimilarEventsResponse,
} from '../../../../packages/contracts/generated/server/worldmonitor/intelligence/v1/service_server';
import { validateHistoryScope, validateHistoryText } from '../../../_shared/intel-history-contract';

/** Hard cap on `limit`, kept from the published contract. */
const MAX_LIMIT = 32;

/** Matches the proto's documented `max_len`. */
const MAX_SITUATION_LEN = 1000;

/**
 * GetSimilarEvents handler.
 *
 * The durable history store (Convex `intelHistory`) was removed with Convex,
 * and the Lite UI does not call this route. The request is still validated,
 * then the handler answers the documented store-outage shape:
 * `upstreamUnavailable: true` with no records, which the gateway serves as
 * no-store. No embeddings call is made.
 */
export const getSimilarEvents: IntelligenceServiceHandler['getSimilarEvents'] = async (
  _ctx: ServerContext,
  req: GetSimilarEventsRequest,
): Promise<GetSimilarEventsResponse> => {
  const situation = validateHistoryText(req.situation, 'situation', 10, MAX_SITUATION_LEN);
  validateHistoryScope(req, MAX_LIMIT);
  return { records: [], situation, partial: false, upstreamUnavailable: true };
};
