import type {
  IntelligenceServiceHandler,
  ServerContext,
  GetIntelTimelineRequest,
  GetIntelTimelineResponse,
} from '../../../../contracts/generated/server/worldmonitor/intelligence/v1/service_server';
import { ValidationError } from '../../../../contracts/generated/server/worldmonitor/intelligence/v1/service_server';
import { validateHistoryScope } from '../../../_shared/intel-history-contract';

/** Hard cap on `limit`, kept from the published contract. */
const MAX_LIMIT = 200;

/**
 * GetIntelTimeline handler.
 *
 * The durable history store (Convex `intelHistory`) was removed with Convex,
 * and the Lite UI does not call this route. The request is still validated,
 * then the handler answers the documented store-outage shape:
 * `upstreamUnavailable: true` with no records, which the gateway serves as
 * no-store. It never reports an empty history as a successful read.
 */
export const getIntelTimeline: IntelligenceServiceHandler['getIntelTimeline'] = async (
  _ctx: ServerContext,
  req: GetIntelTimelineRequest,
): Promise<GetIntelTimelineResponse> => {
  // Normalize BEFORE the scope check: a whitespace-only country would
  // otherwise satisfy "at least one scope" and then match nothing.
  const scope = validateHistoryScope(req, MAX_LIMIT);
  const { domain, country } = scope;
  if (!domain && !country) {
    throw new ValidationError([{ field: 'domain', description: 'At least one of domain or country is required' }]);
  }

  const cursor = req.cursor ?? '';
  if (typeof cursor !== 'string' || cursor.length > 4096) {
    throw new ValidationError([{ field: 'cursor', description: 'cursor must be a string of at most 4096 characters' }]);
  }
  return { records: [], partial: false, upstreamUnavailable: true, nextCursor: '' };
};
