export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createSanctionsServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/sanctions/v1/service_server';
import { sanctionsHandler } from '../../../packages/server/worldmonitor/sanctions/v1/handler';

export default createDomainGateway(
  createSanctionsServiceRoutes(sanctionsHandler, serverOptions),
);
