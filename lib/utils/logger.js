// lib/utils/logger.js
const pino = require('pino');
const pretty = require('pino-pretty');

// Satu env variable: DEBUG_MODE=true untuk debug, false/kosong untuk production
const isDebug = process.env.DEBUG_MODE === 'true';

let logger;

if (isDebug) {
    const stream = pretty({
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
    });
    logger = pino({ level: 'debug' }, stream);
    logger.info({ context: 'logger_init' }, '🐛 DEBUG MODE aktif — log level: debug');
} else {
    logger = pino({ level: 'info' });
}

module.exports = logger;
