export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createCyberServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/cyber/v1/service_server';
import { cyberHandler } from '../../../packages/server/worldmonitor/cyber/v1/handler';

export default createDomainGateway(
  createCyberServiceRoutes(cyberHandler, serverOptions),
);
