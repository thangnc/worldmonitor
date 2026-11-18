export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createUnrestServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/unrest/v1/service_server';
import { unrestHandler } from '../../../packages/server/worldmonitor/unrest/v1/handler';

export default createDomainGateway(
  createUnrestServiceRoutes(unrestHandler, serverOptions),
);
