// -----------------------------------------------------------------------------
// Entry point of the Emporia Vue integration: SDK wiring only.
//
// The supervisor gives the container GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR; the SDK reads them.
// Every handler is registered by createApp() before connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp({ gladys });

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: shutting down`);
  app.stop();
});

logger.info('Starting the Emporia Vue integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message}`);
  process.exit(1);
});
