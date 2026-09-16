import { createBuildingService } from './buildings/index.mjs';
import { readConfig } from './config.mjs';
import { createMapService } from './maps.mjs';
import { createSiteServer } from './site.mjs';

try {
  const config = readConfig();
  const service = createMapService(config.service);
  const buildings = createBuildingService();
  const server = await createSiteServer({ ...config, service, buildings });
  server.on('error', error => { console.error(`Server error: ${error.code || 'unavailable'}`); process.exitCode = 1; });
  server.listen(config.port, config.host, () => console.log(`Lumen Streets: ${config.origin} (website and search)`));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    buildings.close();
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch (error) {
  console.error(`Cannot start Lumen Streets: ${error.message}`);
  process.exitCode = 1;
}
