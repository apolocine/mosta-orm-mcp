// deployer — Template PM2 ecosystem (generique)
// Author: Dr Hamid MADANI <drmdh@msn.com>
//
// Pose ce fichier a la racine de ton projet (ou laisse install.sh le copier).
// Il lit .env voisin pour APP_NAME / START_SCRIPT / START_INTERPRETER /
// START_ARGS. A defaut, des valeurs par defaut raisonnables sont utilisees.
//
// Surcharger via .env :
//   APP_NAME=ticketflow
//   START_SCRIPT=server/server.js
//   START_INTERPRETER=node
//   START_ARGS=
//   MAX_MEMORY_RESTART=512M

const { readFileSync } = require('fs');
const { resolve } = require('path');

const envFile = resolve(__dirname, '.env');
const envVars = {};
try {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    envVars[key.trim()] = rest.join('=').trim();
  }
} catch (e) {
  // .env optionnel
}

const APP_NAME = envVars.APP_NAME || process.env.APP_NAME || 'app';
const START_SCRIPT = envVars.START_SCRIPT || process.env.START_SCRIPT || 'server/server.js';
const START_INTERPRETER = envVars.START_INTERPRETER || process.env.START_INTERPRETER || 'node';
const START_ARGS = envVars.START_ARGS || process.env.START_ARGS || '';
const MAX_MEMORY = envVars.MAX_MEMORY_RESTART || process.env.MAX_MEMORY_RESTART || '512M';

module.exports = {
  apps: [{
    name: APP_NAME,
    script: START_SCRIPT,
    args: START_ARGS,
    interpreter: START_INTERPRETER,
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: MAX_MEMORY,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: resolve(__dirname, 'logs/error.log'),
    out_file: resolve(__dirname, 'logs/out.log'),
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
      ...envVars,
    },
  }],
};
