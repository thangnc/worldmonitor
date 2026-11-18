export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createInfrastructureServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/infrastructure/v1/service_server';
import { infrastructureHandler } from '../../../packages/server/worldmonitor/infrastructure/v1/handler';

export default createDomainGateway(
  createInfrastructureServiceRoutes(infrastructureHandler, serverOptions),
);
