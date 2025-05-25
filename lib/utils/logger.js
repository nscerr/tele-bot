// lib/utils/logger.js
const pino = require('pino');
const pretty = require('pino-pretty');

let logger;

if (process.env.NODE_ENV !== 'production') {
    const stream = pretty({
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
    });
    logger = pino({
        level: process.env.LOG_LEVEL || 'debug',
    }, stream);
} else {
    logger = pino({
        level: process.env.LOG_LEVEL || 'info',
    });
}

module.exports = logger;
