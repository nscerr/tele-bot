// lib/utils/telegram.js
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    console.error("[TG Util] FATAL: TELEGRAM_BOT_TOKEN environment variable not set!");
    // process.exit(1);
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
    // Hapus karakter Markdown yang umum menyebabkan masalah parsing jika tidak di-escape dengan benar
    // Karakter seperti '*' '_', '`', '[', ']'
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
            console.warn(`[TG Util] Initial send for ${endpoint} to chat ${chatIdForLog} failed due to parse error. Retrying without Markdown. Error: ${errorDetails}`);

            const fallbackPayload = { ...initialPayload };
            delete fallbackPayload.parse_mode; // Hapus parse_mode dari root payload

            const cleanedContent = stripMarkdownSyntaxForFallback(originalContent);
            if (isContentCaption) {
                fallbackPayload.caption = cleanedContent;
            } else {
                fallbackPayload.text = cleanedContent;
            }

            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout });
                console.log(`[TG Util] Fallback send for ${endpoint} to chat ${chatIdForLog} successful after stripping syntax.`);
            } catch (fallbackError) {
                const fallbackErrorDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                console.error(`[TG Util] Fallback send for ${endpoint} to chat ${chatIdForLog} also failed:`, fallbackErrorDetails);
                throw fallbackError;
            }
        } else {
            if (isParseError && !originalContent) {
                const chatIdForLog = initialPayload.chat_id || 'N/A';
                console.warn(`[TG Util] Parse error detected for ${endpoint} to chat ${chatIdForLog}, but no original content provided for fallback. Error: ${errorDetails}`);
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
        console.error(`[TG Util] Failed to send message to chat ${chatId}:`, errorMessage);
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
        console.warn(`[TG Util] Media ${type} for chat ${chatId} (URL: ${url}) size (${(mediaSizeInBytes / (1024*1024)).toFixed(2)}MB) exceeds Telegram limit (${sizeLimitMb}MB). Skipping send.`);
        return false;
    }

    const endpoint = type === 'video' ? 'sendVideo' : (type === 'photo' ? 'sendPhoto' : null);
    if (!endpoint) {
        console.error(`[TG Util] Unsupported media type for trySendMedia: ${type}`);
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

    console.log(`[TG Util] Attempting ${endpoint} for chat ${chatId} (URL: ${url}, Size: ${(mediaSizeInBytes > 0 ? (mediaSizeInBytes / (1024*1024)).toFixed(2) + 'MB' : 'Unknown')})`);
    try {
        // Helper _tryPostWithMarkdownFallback cocok di sini karena parse_mode ada di root payload jika caption ada.
        await _tryPostWithMarkdownFallback(endpoint, payload, SEND_MEDIA_TIMEOUT, caption, true);
        console.log(`[TG Util] ${endpoint} successful for chat ${chatId}.`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[TG Util] Error using ${endpoint} for chat ${chatId} (URL: ${url}) - Final status:`, errorDetails);

        if (errorDetails.includes('failed to get HTTP URL content')) {
            console.warn(`[TG Util] >>> Telegram failed to fetch content from URL: ${url}`);
        } else if (errorDetails.includes('wrong file identifier')) {
            console.warn(`[TG Util] >>> Telegram reported 'wrong file identifier/HTTP URL specified' for URL: ${url}`);
        } else if (errorDetails.includes('WEBPAGE_CURL_FAILED')) {
            console.warn(`[TG Util] >>> Telegram reported WEBPAGE_CURL_FAILED for URL: ${url}. Check if the URL is publicly accessible.`);
        } else if (errorDetails.toLowerCase().includes('file is too big') || errorDetails.toLowerCase().includes('too large')) {
            console.warn(`[TG Util] >>> Telegram reported file is too large for URL: ${url}`);
        }
        return false;
    }
}

// --- Modifikasi pada sendAlbum untuk mengembalikan logika fallback spesifik ---
async function sendAlbum(chatId, mediaGroupOriginal) { // Ubah nama parameter agar jelas
    if (!mediaGroupOriginal || mediaGroupOriginal.length < 2 || mediaGroupOriginal.length > 10) {
        console.error(`[TG Util] Invalid mediaGroupOriginal for sendAlbum (must be 2-10 items, got ${mediaGroupOriginal?.length}).`);
        return false;
    }

    const endpoint = 'sendMediaGroup';

    // Proses media group untuk percobaan pertama dengan Markdown
    let firstAttemptMediaGroup = mediaGroupOriginal.map((item, index) => {
        if (!item || !item.type || !item.media || (item.type !== 'photo' && item.type !== 'video')) {
            console.error(`[TG Util] Invalid media item at index ${index} in sendAlbum for chat ${chatId}.`);
            return null;
        }
        const newItem = { ...item };
        if (index === 0 && newItem.caption) {
            newItem.parse_mode = 'Markdown'; // Hanya item pertama yang boleh punya parse_mode
        } else {
            delete newItem.caption;
            delete newItem.parse_mode;
        }
        return newItem;
    }).filter(item => item !== null);

    if (firstAttemptMediaGroup.length < 2) {
        console.error(`[TG Util] Not enough valid items in mediaGroup for sendAlbum for chat ${chatId} after filtering (first attempt).`);
        return false;
    }

    const firstAttemptPayload = {
        chat_id: chatId,
        media: JSON.stringify(firstAttemptMediaGroup),
    };

    console.log(`[TG Util] Attempting ${endpoint} for chat ${chatId} with ${firstAttemptMediaGroup.length} items (with Markdown).`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, firstAttemptPayload, { timeout: SEND_ALBUM_TIMEOUT });
        console.log(`[TG Util] ${endpoint} successful for chat ${chatId} (with Markdown).`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        const isParseError = error.response && (
            errorDetails.includes("parse_mode") ||
            errorDetails.includes("parse entities") ||
            errorDetails.includes("can't parse entities")
        );

        if (isParseError && mediaGroupOriginal[0]?.caption) {
            console.warn(`[TG Util] Initial send for ${endpoint} to chat ${chatId} failed due to parse error. Retrying without Markdown for caption. Error: ${errorDetails}`);

            // Siapkan media group untuk fallback
            const fallbackMediaGroup = mediaGroupOriginal.map((item, index) => {
                const newItem = { ...item }; // Salin dari original untuk memastikan kebersihan
                // Hapus parse_mode dari semua item untuk fallback
                delete newItem.parse_mode;
                if (index === 0 && newItem.caption) {
                    newItem.caption = stripMarkdownSyntaxForFallback(newItem.caption); // Bersihkan caption item pertama
                } else if (index !== 0) {
                    // Pastikan item lain tidak punya caption, sesuai aturan sendMediaGroup
                    delete newItem.caption;
                }
                return newItem;
            }).filter(item => item !== null); // Filter lagi jika ada item tidak valid di original

            if (fallbackMediaGroup.length < 2) {
                 console.error(`[TG Util] Not enough valid items for fallback sendAlbum for chat ${chatId}.`);
                 // Melempar error asli karena fallback tidak bisa dilakukan
                 console.error(`[TG Util] Original error for ${endpoint} for chat ${chatId}:`, errorDetails);
                 return false;
            }

            const fallbackPayload = {
                chat_id: chatId,
                media: JSON.stringify(fallbackMediaGroup),
            };

            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout: SEND_ALBUM_TIMEOUT });
                console.log(`[TG Util] Fallback send for ${endpoint} to chat ${chatId} successful after stripping syntax.`);
                return true;
            } catch (fallbackError) {
                const fallbackErrorDetails = fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message;
                console.error(`[TG Util] Fallback send for ${endpoint} to chat ${chatId} also failed:`, fallbackErrorDetails);
                return false;
            }
        } else {
            // Bukan error parsing yang bisa ditangani, atau item pertama tidak punya caption
            console.error(`[TG Util] Error using ${endpoint} for chat ${chatId} (no fallback attempted or applicable):`, errorDetails);
            if (errorDetails.includes('failed to get HTTP URL content') && mediaGroupOriginal[0]?.media) {
                console.warn(`[TG Util] >>> Telegram failed to fetch content for the first item in album: ${mediaGroupOriginal[0].media}`);
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
