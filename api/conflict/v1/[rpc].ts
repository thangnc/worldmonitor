export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createConflictServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/conflict/v1/service_server';
import { conflictHandler } from '../../../packages/server/worldmonitor/conflict/v1/handler';

export default createDomainGateway(
  createConflictServiceRoutes(conflictHandler, serverOptions),
);
