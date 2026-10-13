// The calculation off the page (driven by calc-client.js): keeps the banner
// data it is sent and runs each job.

import { runJob } from './core/calc-job.js';

let data = null;

self.onmessage = ({ data: msg }) => {
  if (msg.type === 'data') data = msg.data;
  else if (msg.type === 'run') runJob(msg, data, (m) => self.postMessage(m));
};
