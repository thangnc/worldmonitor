import type { SanctionsServiceHandler } from '../../../../packages/contracts/generated/server/worldmonitor/sanctions/v1/service_server';

import { listSanctionsPressure } from './list-sanctions-pressure';
import { lookupSanctionEntity } from './lookup-entity';

export const sanctionsHandler: SanctionsServiceHandler = {
  listSanctionsPressure,
  lookupSanctionEntity,
};
