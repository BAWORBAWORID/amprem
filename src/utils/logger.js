/**
 * Logger ringan berwarna — meniru pola apiku/src/utils/logger.js
 */
const C = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

const logger = {
    info: (msg) => console.log(C.blue + '• ' + C.gray + 'info  - ' + C.reset + msg),
    ready: (msg) => console.log(C.green + '• ' + C.gray + 'ready - ' + C.reset + msg),
    warn: (msg) => console.log(C.yellow + '• ' + C.gray + 'warn  - ' + C.reset + msg),
    error: (msg) => console.log(C.red + '• ' + C.gray + 'error - ' + C.reset + msg),
    event: (msg) => console.log(C.cyan + '• ' + C.gray + 'event - ' + C.reset + msg),
};

export default logger;
