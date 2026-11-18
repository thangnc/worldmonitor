export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createSeismologyServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/seismology/v1/service_server';
import { seismologyHandler } from '../../../packages/server/worldmonitor/seismology/v1/handler';

export default createDomainGateway(
  createSeismologyServiceRoutes(seismologyHandler, serverOptions),
);
