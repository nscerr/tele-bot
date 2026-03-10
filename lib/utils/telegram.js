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

function stripMarkdownSyntaxForFallback(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/[*_`[\]()]/g, '');
}

async function _tryPostWithMarkdownFallback(endpoint, initialPayload, timeout, originalContent, isContentCaption = false) {
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, initialPayload, { timeout });
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        const isParseError = error.response && (
            errorDetails.includes("parse_mode") ||
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );

        if (isParseError && originalContent) {
            const chatIdForLog = initialPayload.chat_id || 'N/A';
            logger.warn({ chatId: chatIdForLog, endpoint, errorDetails, context: 'tryPost_markdownFallback' },
                `Parse error on ${endpoint}, retrying without Markdown.`);

            const fallbackPayload = { ...initialPayload };
            delete fallbackPayload.parse_mode;

            const cleanedContent = stripMarkdownSyntaxForFallback(originalContent);
            if (isContentCaption) {
                fallbackPayload.caption = cleanedContent;
            } else {
                fallbackPayload.text = cleanedContent;
            }

            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout });
                logger.info({ chatId: chatIdForLog, endpoint, context: 'tryPost_markdownFallback' },
                    `Fallback send successful after stripping Markdown.`);
            } catch (fallbackError) {
                const fallbackErrorDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                logger.error({ chatId: chatIdForLog, endpoint, fallbackErrorDetails, context: 'tryPost_markdownFallback' },
                    `Fallback send also failed.`);
                throw fallbackError;
            }
        } else {
            if (isParseError && !originalContent) {
                logger.warn({ chatId: initialPayload.chat_id, endpoint, errorDetails, context: 'tryPost_markdownFallback' },
                    'Parse error detected but no original content for fallback.');
            }
            throw error;
        }
    }
}

async function sendMessage(chatId, text, replyMarkup = null, replyToMessageId = null) {
    const endpoint = 'sendMessage';
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: !replyMarkup
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

    try {
        await _tryPostWithMarkdownFallback(endpoint, payload, SEND_MESSAGE_TIMEOUT, text, false);
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error({ chatId, endpoint, errorMessage, context: 'sendMessage' }, `Failed to send message.`);
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
            `Media exceeds Telegram size limit. Skipping.`);
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
        payload.parse_mode = 'Markdown';
    }
    if (replyMarkup) payload.reply_markup = replyMarkup;

    logger.info({ chatId, type, endpoint, url, context: 'trySendMedia' }, `Attempting ${endpoint}.`);
    try {
        await _tryPostWithMarkdownFallback(endpoint, payload, SEND_MEDIA_TIMEOUT, caption, true);
        logger.info({ chatId, endpoint, context: 'trySendMedia' }, `${endpoint} successful.`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
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
            `Invalid mediaGroup for sendAlbum (must be 2-10 items).`);
        return false;
    }

    const endpoint = 'sendMediaGroup';

    let firstAttemptMediaGroup = mediaGroupOriginal.map((item, index) => {
        if (!item || !item.type || !item.media || (item.type !== 'photo' && item.type !== 'video')) {
            logger.error({ chatId, index, context: 'sendAlbum' }, `Invalid media item at index ${index}.`);
            return null;
        }
        const newItem = { ...item };
        if (index === 0 && newItem.caption) {
            newItem.parse_mode = 'Markdown';
        } else {
            delete newItem.caption;
            delete newItem.parse_mode;
        }
        return newItem;
    }).filter(item => item !== null);

    if (firstAttemptMediaGroup.length < 2) {
        logger.error({ chatId, context: 'sendAlbum' }, 'Not enough valid items after filtering.');
        return false;
    }

    const firstAttemptPayload = {
        chat_id: chatId,
        media: JSON.stringify(firstAttemptMediaGroup),
    };

    logger.info({ chatId, count: firstAttemptMediaGroup.length, context: 'sendAlbum' },
        `Attempting ${endpoint} with ${firstAttemptMediaGroup.length} items.`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, firstAttemptPayload, { timeout: SEND_ALBUM_TIMEOUT });
        logger.info({ chatId, context: 'sendAlbum' }, `${endpoint} successful.`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        const isParseError = error.response && (
            errorDetails.includes("parse_mode") ||
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );

        if (isParseError && mediaGroupOriginal[0]?.caption) {
            logger.warn({ chatId, errorDetails, context: 'sendAlbum' },
                `Parse error, retrying without Markdown.`);

            const fallbackMediaGroup = mediaGroupOriginal.map((item, index) => {
                const newItem = { ...item };
                delete newItem.parse_mode;
                if (index === 0 && newItem.caption) {
                    newItem.caption = stripMarkdownSyntaxForFallback(newItem.caption);
                } else if (index !== 0) {
                    delete newItem.caption;
                }
                return newItem;
            }).filter(item => item !== null);

            if (fallbackMediaGroup.length < 2) {
                logger.error({ chatId, context: 'sendAlbum' }, 'Not enough valid items for fallback.');
                return false;
            }

            const fallbackPayload = {
                chat_id: chatId,
                media: JSON.stringify(fallbackMediaGroup),
            };

            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout: SEND_ALBUM_TIMEOUT });
                logger.info({ chatId, context: 'sendAlbum' }, 'Fallback send successful.');
                return true;
            } catch (fallbackError) {
                const fallbackErrorDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                logger.error({ chatId, fallbackErrorDetails, context: 'sendAlbum' }, 'Fallback send also failed.');
                return false;
            }
        } else {
            logger.error({ chatId, errorDetails, context: 'sendAlbum' }, `Error using ${endpoint}.`);
            if (errorDetails.includes('failed to get HTTP URL content') && mediaGroupOriginal[0]?.media) {
                logger.warn({ chatId, firstMedia: mediaGroupOriginal[0].media, context: 'sendAlbum' },
                    'Telegram failed to fetch first album item.');
            }
            return false;
        }
    }
}

module.exports = {
    sendMessage,
    trySendMedia,
    sendAlbum,
    stripMarkdownSyntaxForFallback,
    TELEGRAM_VIDEO_SIZE_LIMIT_BYTES,
    TELEGRAM_PHOTO_SIZE_LIMIT_BYTES,
    TELEGRAM_GENERAL_MEDIA_SIZE_LIMIT_BYTES
};

