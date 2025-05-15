// lib/utils/telegram.js
const axios = require('axios');
// const he = require('he'); // he tidak digunakan langsung di sini
const { timestampToDate } = require('./time');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    console.error("[TG Util] FATAL: TELEGRAM_BOT_TOKEN environment variable not set!");
}
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const SEND_MEDIA_TIMEOUT = 60000;
const SEND_MESSAGE_TIMEOUT = 10000;
const SEND_ALBUM_TIMEOUT = 75000;

// Hapus fungsi escapeMarkdownV2 karena tidak dipakai lagi

async function sendMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown' // <-- Ubah ke Markdown Legacy
        };
        if (replyMarkup) {
            payload.reply_markup = replyMarkup;
        }
        payload.disable_web_page_preview = !replyMarkup;

        await axios.post(`${TELEGRAM_API_BASE_URL}/sendMessage`, payload, { timeout: SEND_MESSAGE_TIMEOUT });
    } catch (error) {
        console.error(`[TG Util] Error sending message to chat ${chatId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
        // Fallback tanpa markdown jika parse error
         if (error.response && JSON.stringify(error.response.data).includes("parse entities")) { // Cukup cek "parse entities"
             console.warn(`[TG Util] Retrying sendMessage for chat ${chatId} without Markdown due to parse error.`);
            try {
                const fallbackPayload = { chat_id: chatId, text: text };
                if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
                fallbackPayload.disable_web_page_preview = !replyMarkup;
                await axios.post(`${TELEGRAM_API_BASE_URL}/sendMessage`, fallbackPayload, { timeout: SEND_MESSAGE_TIMEOUT });
            } catch (fallbackError) {
                 console.error(`[TG Util] Error sending fallback message for chat ${chatId}:`, fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message);
            }
        }
    }
}


async function trySendMedia(chatId, type, url, caption, replyMarkup) {
    const endpoint = type === 'video' ? 'sendVideo' : 'sendPhoto';
    const payload = {
        chat_id: chatId,
        [type]: url,
        caption: caption,
        parse_mode: 'Markdown' // <-- Ubah ke Markdown Legacy
    };
    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }

    console.log(`[TG Util] Attempting ${endpoint} for chat ${chatId} with URL: ${url}`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, payload, { timeout: SEND_MEDIA_TIMEOUT });
        console.log(`[TG Util] ${endpoint} successful for chat ${chatId}`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[TG Util] Error using ${endpoint} for chat ${chatId} (URL: ${url}):`, errorDetails);
        // Fallback tanpa markdown jika parse error
        if (errorDetails.includes("parse entities")) {
            console.warn(`[TG Util] Retrying ${endpoint} for chat ${chatId} without Markdown due to parse error.`);
            try {
                const fallbackPayload = { chat_id: chatId, [type]: url, caption: caption };
                if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
                await axios.post(`${TELEGRAM_API_BASE_URL}/${endpoint}`, fallbackPayload, { timeout: SEND_MEDIA_TIMEOUT });
                 console.log(`[TG Util] Fallback ${endpoint} successful for chat ${chatId}`);
                return true;
            } catch (fallbackError) {
                 console.error(`[TG Util] Error sending fallback ${endpoint} for chat ${chatId}:`, fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message);
                 return false;
            }
        }
        // Handle error lain
        if (errorDetails.includes('failed to get HTTP URL content')) {
             console.warn(`[TG Util] >>> Telegram failed to fetch content from URL: ${url}`);
        } else if (errorDetails.includes('wrong file identifier')) {
            console.warn(`[TG Util] >>> Telegram reported 'wrong file identifier/HTTP URL specified' for URL: ${url}`);
        }
        return false;
    }
}


async function sendAlbum(chatId, mediaGroup) {
    if (!mediaGroup || mediaGroup.length < 2 || mediaGroup.length > 10) {
        console.error(`[TG Util] Invalid mediaGroup for sendAlbum (must be 2-10 items, got ${mediaGroup?.length}):`, mediaGroup);
        return false;
    }

    // Proses mediaGroup untuk pastikan parse_mode di item pertama jika ada caption
    const processedMediaGroup = mediaGroup.map((item, index) => {
        if (!item || !item.type || !item.media || (item.type !== 'photo' && item.type !== 'video')) {
             throw new Error(`Invalid media item at index ${index}`);
        }
        const newItem = { ...item };
        if (index === 0 && newItem.caption) {
            newItem.parse_mode = 'Markdown'; // <-- Ubah ke Markdown Legacy
        } else {
             delete newItem.caption;
             delete newItem.parse_mode;
        }
        return newItem;
    });

    const payload = {
        chat_id: chatId,
        media: JSON.stringify(processedMediaGroup),
    };

    console.log(`[TG Util] Attempting sendMediaGroup for chat ${chatId} with ${processedMediaGroup.length} items.`);
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/sendMediaGroup`, payload, { timeout: SEND_ALBUM_TIMEOUT });
        console.log(`[TG Util] sendMediaGroup successful for chat ${chatId}`);
        return true;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[TG Util] Error using sendMediaGroup for chat ${chatId}:`, errorDetails);
        // Fallback tanpa markdown jika parse error
        if (errorDetails.includes("parse entities") && mediaGroup[0]?.caption) {
             console.warn(`[TG Util] Retrying sendMediaGroup for chat ${chatId} without Markdown due to parse error.`);
             try {
                 const fallbackMediaGroup = mediaGroup.map((item, index) => {
                     const newItem = { ...item };
                     if (index !== 0) delete newItem.caption;
                     delete newItem.parse_mode; // Hapus parse_mode
                     return newItem;
                 });
                 const fallbackPayload = { chat_id: chatId, media: JSON.stringify(fallbackMediaGroup) };
                 await axios.post(`${TELEGRAM_API_BASE_URL}/sendMediaGroup`, fallbackPayload, { timeout: SEND_ALBUM_TIMEOUT });
                 console.log(`[TG Util] Fallback sendMediaGroup successful for chat ${chatId}`);
                 return true;
             } catch (fallbackError) {
                 console.error(`[TG Util] Error sending fallback sendMediaGroup for chat ${chatId}:`, fallbackError.response ? JSON.stringify(fallbackError.response.data) : fallbackError.message);
                 return false;
            }
        }
        // Handle error lain
        if (errorDetails.includes('failed to get HTTP URL content') && mediaGroup[0]?.media) {
             console.warn(`[TG Util] >>> Telegram failed to fetch content for the first item in album: ${mediaGroup[0].media}`);
        }
        return false;
    }
}

// Hapus escapeMarkdownV2 dari exports
module.exports = {
    sendMessage,
    trySendMedia,
    sendAlbum
};