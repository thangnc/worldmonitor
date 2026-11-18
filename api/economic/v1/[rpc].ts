export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createEconomicServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/economic/v1/service_server';
import { economicHandler } from '../../../packages/server/worldmonitor/economic/v1/handler';

export default createDomainGateway(
  createEconomicServiceRoutes(economicHandler, serverOptions),
);
