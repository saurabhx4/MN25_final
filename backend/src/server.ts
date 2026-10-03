import { createApp } from './app';
import { env } from './config/env';

const app = createApp();
app.listen(env.port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`MN25 backend listening on :${env.port}`);
});
