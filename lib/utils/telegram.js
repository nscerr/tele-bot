// lib/utils/telegram.js
const axios = require('axios');
const logger = require('./logger');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    logger.error({ context: 'telegram_init' }, 'FATAL: TELEGRAM_BOT_TOKEN environment variable not set!');
}
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const SEND_MEDIA_TIMEOUT = 60000;
const SEND_MESSAGE_TIMEOUT = 10000;
const SEND_ALBUM_TIMEOUT = 75000;

const TELEGRAM_VIDEO_SIZE_LIMIT_MB = 49;
const TELEGRAM_VIDEO_SIZE_LIMIT_BYTES = TELEGRAM_VIDEO_SIZE_LIMIT_MB * 1024 * 1024;
const TELEGRAM_PHOTO_SIZE_LIMIT_MB = 10;
const TELEGRAM_PHOTO_SIZE_LIMIT_BYTES = TELEGRAM_PHOTO_SIZE_LIMIT_MB * 1024 * 1024;
const TELEGRAM_GENERAL_MEDIA_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * Escape karakter khusus HTML agar aman untuk Telegram parse_mode HTML.
 * Hanya 3 karakter yang perlu di-escape: &, <, >
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendMessage(chatId, text, replyMarkup = null, replyToMessageId = null) {
    const endpoint = 'sendMessage';
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: !replyMarkup
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, payload, { timeout: SEND_MESSAGE_TIMEOUT });
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        const isParseError = error.response && (
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );

        // Jika parse error, coba kirim ulang tanpa parse_mode
        if (isParseError) {
            logger.warn({ chatId, endpoint, errorDetails, context: 'sendMessage' }, 'HTML parse error, retrying without parse_mode.');
            try {
                const fallbackPayload = { ...payload };
                delete fallbackPayload.parse_mode;
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout: SEND_MESSAGE_TIMEOUT });
            } catch (fallbackError) {
                const fbDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                logger.error({ chatId, endpoint, errorDetails: fbDetails, context: 'sendMessage' }, 'Fallback send also failed.');
            }
        } else {
            logger.error({ chatId, endpoint, errorDetails, context: 'sendMessage' }, 'Failed to send message.');
        }
    }
}

async function trySendMedia(chatId, type, url, caption, replyMarkup, mediaSizeInBytes = 0) {
    let sizeLimitBytes = TELEGRAM_GENERAL_MEDIA_SIZE_LIMIT_BYTES;
    let sizeLimitMb = sizeLimitBytes / (1024 * 1024);

    if (type === 'video') {
        sizeLimitBytes = TELEGRAM_VIDEO_SIZE_LIMIT_BYTES;
        sizeLimitMb = TELEGRAM_VIDEO_SIZE_LIMIT_MB;
    } else if (type === 'photo') {
        sizeLimitBytes = TELEGRAM_PHOTO_SIZE_LIMIT_BYTES;
        sizeLimitMb = TELEGRAM_PHOTO_SIZE_LIMIT_MB;
    }

    if (mediaSizeInBytes > 0 && mediaSizeInBytes > sizeLimitBytes) {
        logger.warn({ chatId, type, url, sizeMb: (mediaSizeInBytes / (1024 * 1024)).toFixed(2), limitMb: sizeLimitMb, context: 'trySendMedia' },
            'Media exceeds Telegram size limit. Skipping.');
        return false;
    }

    const endpoint = type === 'video' ? 'sendVideo' : (type === 'photo' ? 'sendPhoto' : null);
    if (!endpoint) {
        logger.error({ chatId, type, context: 'trySendMedia' }, `Unsupported media type: ${type}`);
        return false;
    }

    const payload = {
        chat_id: chatId,
        [type]: url,
    };
    if (caption) {
        payload.caption = caption;
        payload.parse_mode = 'HTML';
    }
    if (replyMarkup) payload.reply_markup = replyMarkup;

    logger.info({ chatId, type, endpoint, url, context: 'trySendMedia' }, `Attempting ${endpoint}.`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, payload, { timeout: SEND_MEDIA_TIMEOUT });
        logger.info({ chatId, endpoint, context: 'trySendMedia' }, `${endpoint} successful.`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;

        // Jika parse error pada caption, coba tanpa parse_mode
        const isParseError = error.response && (
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );
        if (isParseError && caption) {
            logger.warn({ chatId, endpoint, context: 'trySendMedia' }, 'HTML parse error on caption, retrying without parse_mode.');
            try {
                const fallbackPayload = { ...payload };
                delete fallbackPayload.parse_mode;
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout: SEND_MEDIA_TIMEOUT });
                logger.info({ chatId, endpoint, context: 'trySendMedia' }, `${endpoint} successful (fallback no parse_mode).`);
                return true;
            } catch (fbError) {
                const fbDetails = fbError.response ? JSON.stringify(fbError.response.data) : fbError.message;
                logger.error({ chatId, endpoint, url, errorDetails: fbDetails, context: 'trySendMedia' }, 'Fallback also failed.');
            }
        }

        logger.error({ chatId, endpoint, url, errorDetails, context: 'trySendMedia' }, `Error using ${endpoint}.`);

        if (errorDetails.includes('failed to get HTTP URL content')) {
            logger.warn({ chatId, url, context: 'trySendMedia' }, 'Telegram failed to fetch content from URL.');
        } else if (errorDetails.includes('wrong file identifier')) {
            logger.warn({ chatId, url, context: 'trySendMedia' }, 'Wrong file identifier/HTTP URL.');
        } else if (errorDetails.includes('WEBPAGE_CURL_FAILED')) {
            logger.warn({ chatId, url, context: 'trySendMedia' }, 'WEBPAGE_CURL_FAILED - URL may not be publicly accessible.');
        } else if (errorDetails.toLowerCase().includes('file is too big') || errorDetails.toLowerCase().includes('too large')) {
            logger.warn({ chatId, url, context: 'trySendMedia' }, 'File is too large for Telegram.');
        }
        return false;
    }
}

async function sendAlbum(chatId, mediaGroupOriginal) {
    if (!mediaGroupOriginal || mediaGroupOriginal.length < 2 || mediaGroupOriginal.length > 10) {
        logger.error({ chatId, count: mediaGroupOriginal?.length, context: 'sendAlbum' },
            'Invalid mediaGroup for sendAlbum (must be 2-10 items).');
        return false;
    }

    const endpoint = 'sendMediaGroup';

    let mediaGroup = mediaGroupOriginal.map((item, index) => {
        if (!item || !item.type || !item.media || (item.type !== 'photo' && item.type !== 'video')) {
            logger.error({ chatId, index, context: 'sendAlbum' }, `Invalid media item at index ${index}.`);
            return null;
        }
        const newItem = { ...item };
        if (index === 0 && newItem.caption) {
            newItem.parse_mode = 'HTML';
        } else {
            delete newItem.caption;
            delete newItem.parse_mode;
        }
        return newItem;
    }).filter(item => item !== null);

    if (mediaGroup.length < 2) {
        logger.error({ chatId, context: 'sendAlbum' }, 'Not enough valid items after filtering.');
        return false;
    }

    const payload = {
        chat_id: chatId,
        media: JSON.stringify(mediaGroup),
    };

    logger.info({ chatId, count: mediaGroup.length, context: 'sendAlbum' },
        `Attempting ${endpoint} with ${mediaGroup.length} items.`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, payload, { timeout: SEND_ALBUM_TIMEOUT });
        logger.info({ chatId, context: 'sendAlbum' }, `${endpoint} successful.`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        const isParseError = error.response && (
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );

        if (isParseError && mediaGroupOriginal[0]?.caption) {
            logger.warn({ chatId, errorDetails, context: 'sendAlbum' }, 'HTML parse error, retrying without parse_mode.');

            const fallbackMediaGroup = mediaGroupOriginal.map((item, index) => {
                const newItem = { ...item };
                delete newItem.parse_mode;
                if (index !== 0) delete newItem.caption;
                return newItem;
            }).filter(item => item !== null);

            if (fallbackMediaGroup.length < 2) {
                logger.error({ chatId, context: 'sendAlbum' }, 'Not enough valid items for fallback.');
                return false;
            }

            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, {
                    chat_id: chatId,
                    media: JSON.stringify(fallbackMediaGroup),
                }, { timeout: SEND_ALBUM_TIMEOUT });
                logger.info({ chatId, context: 'sendAlbum' }, 'Fallback send successful.');
                return true;
            } catch (fallbackError) {
                const fbDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                logger.error({ chatId, errorDetails: fbDetails, context: 'sendAlbum' }, 'Fallback send also failed.');
                return false;
            }
        } else {
            logger.error({ chatId, errorDetails, context: 'sendAlbum' }, `Error using ${endpoint}.`);
            return false;
        }
    }
}

module.exports = {
    sendMessage,
    trySendMedia,
    sendAlbum,
    escapeHtml,
    TELEGRAM_VIDEO_SIZE_LIMIT_BYTES,
    TELEGRAM_PHOTO_SIZE_LIMIT_BYTES,
    TELEGRAM_GENERAL_MEDIA_SIZE_LIMIT_BYTES
};
