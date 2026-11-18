import type { SanctionsServiceHandler } from '../../../../contracts/generated/server/worldmonitor/sanctions/v1/service_server';

import { listSanctionsPressure } from './list-sanctions-pressure';
import { lookupSanctionEntity } from './lookup-entity';

export const sanctionsHandler: SanctionsServiceHandler = {
  listSanctionsPressure,
  lookupSanctionEntity,
};
