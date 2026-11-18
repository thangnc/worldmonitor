export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../packages/server/gateway';
import { createResearchServiceRoutes } from '../../../packages/contracts/generated/server/worldmonitor/research/v1/service_server';
import { researchHandler } from '../../../packages/server/worldmonitor/research/v1/handler';

export default createDomainGateway(
  createResearchServiceRoutes(researchHandler, serverOptions),
);
