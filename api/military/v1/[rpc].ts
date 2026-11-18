export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createMilitaryServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/military/v1/service_server';
import { militaryHandler } from '../../../server/worldmonitor/military/v1/handler';

export default createDomainGateway(
  createMilitaryServiceRoutes(militaryHandler, serverOptions),
);
