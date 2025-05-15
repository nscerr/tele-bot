// api/webhook.js
const axios = require('axios');

const { detectLinkType } = require('../lib/utils/linkDetector');
const { sendMessage } = require('../lib/utils/telegram');
const { handleFacebookLink } = require('../lib/handlers/facebook');
// Impor fungsi get/clear deskripsi TikTok & Instagram
const { handleTikTokLink, getStoredTikTokDescription, clearStoredTikTokDescription } = require('../lib/handlers/tiktok');
const { handleInstagramLink, getStoredInstagramDescription, clearStoredInstagramDescription } = require('../lib/handlers/instagram'); // Impor fungsi IG
const { handleTwitterLink } = require('../lib/handlers/twitter');
const { handleDouyinLink } = require('../lib/handlers/douyin');

const userState = {};
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;


// --- Fungsi Handle Callback Query (Diperbarui) ---
async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const callbackQueryId = callbackQuery.id;
    const originalMessageId = callbackQuery.message.message_id;

    console.log(`[Webhook] Received Callback Query: ${data} from chat ${chatId}`);

    let description = null;
    let descriptionType = ''; // Untuk logging
    let clearFunction = null;
    let targetChatId = chatId; // Default ke chat ID saat ini
    let mediaId = null;

    // --- Deteksi Tipe Callback ---
    if (data.startsWith('ttdesc:')) {
        const parts = data.split(':');
        if (parts.length === 3) {
            targetChatId = parts[1];
            mediaId = parts[2];
            description = getStoredTikTokDescription(targetChatId, mediaId);
            descriptionType = 'TikTok';
            clearFunction = clearStoredTikTokDescription;
        } else {
            console.warn(`[Webhook] Invalid ttdesc callback data format: ${data}`);
        }
    } else if (data.startsWith('igdesc:')) { // <-- Tambah handler untuk Instagram
        const parts = data.split(':');
        if (parts.length === 3) {
            targetChatId = parts[1];
            mediaId = parts[2];
            description = getStoredInstagramDescription(targetChatId, mediaId); // <-- Panggil fungsi IG
            descriptionType = 'Instagram';
            clearFunction = clearStoredInstagramDescription; // <-- Panggil fungsi clear IG
        } else {
            console.warn(`[Webhook] Invalid igdesc callback data format: ${data}`);
        }
    } else if (data === 'noop') {
        // Handle tombol dummy - cukup jawab OK
        try {
            await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, { callback_query_id: callbackQueryId });
        } catch (error) { console.error(`[Webhook] Error answering noop callback query:`, error); }
        return; // Keluar setelah menangani noop
    } else {
        // Handle callback data tidak dikenal
        console.warn(`[Webhook] Unhandled callback_data: ${data}`);
        try { await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text: 'Aksi tidak dikenal.' }); } catch (e) {}
        return; // Keluar setelah menangani unknown
    }


    // --- Proses Jika Deskripsi Ditemukan atau Tidak ---
    if (descriptionType && mediaId) { // Pastikan tipe dan ID valid
        if (description) {
            // Kirim deskripsi sebagai pesan baru
            try {
                await sendMessage(targetChatId, `📝 *Deskripsi Lengkap (${descriptionType}):*\n\n${description}`, null, originalMessageId);
                console.log(`[Webhook] Sent ${descriptionType} description as message for chat ${chatId}, media ${mediaId}`);
                try { await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, { callback_query_id: callbackQueryId }); } catch (e) {}
                clearFunction(targetChatId, mediaId); // Panggil fungsi clear yang sesuai
            } catch (sendError) {
                console.error(`[Webhook] Error sending ${descriptionType} description message:`, sendError);
                try { await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text: 'Gagal mengirim deskripsi.', show_alert: true }); } catch (e) {}
                clearFunction(targetChatId, mediaId); // Tetap clear
            }
        } else {
            // Deskripsi tidak ditemukan
            console.warn(`[Webhook] No stored ${descriptionType} description found for callback: chat ${targetChatId}, media ${mediaId}`);
            try {
                await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: 'Deskripsi sudah ditampilkan atau tidak tersedia lagi.',
                    show_alert: false
                });
            } catch (error) { console.error(`[Webhook] Error answering callback query (not found):`, error);}
        }
    } else if (!data.startsWith('noop')) { // Hanya tampilkan error jika bukan noop dan bukan tipe dikenal
         // Format data callback tidak valid atau tipe tidak dikenal setelah dicek
         try { await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text: 'Error: Data tombol tidak valid.' }); } catch (e) {}
    }
}


// --- Handler Utama (module.exports = ...) ---
// Bagian ini TIDAK BERUBAH dari versi sebelumnya.
// Logika pemanggilan handler sudah benar.
module.exports = async (req, res) => {
    // ... (Kode handler utama tidak berubah) ...
     if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const update = req.body;

        // TANGANI CALLBACK QUERY DULU
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return res.status(200).send('OK');
        }

        // LANJUTKAN DENGAN PESAN BIASA
        if (!update.message) {
            console.log('[Webhook] Not a message or callback query update, ignoring.');
            return res.status(200).send('OK');
        }

        const message = update.message;
        const chatId = message.chat.id;
        const messageText = message.text;
        const messageId = message.message_id;

        if (!userState[chatId]) {
            userState[chatId] = { nonLinkCounter: 0 };
        }

        if (messageText) {
            if (messageText === '/start') {
                userState[chatId].nonLinkCounter = 0;
                await sendMessage(chatId, "Selamat datang! 👋 Kirimkan saya link video dari Facebook, TikTok, Instagram, Twitter/X, atau Douyin!", null, messageId);
                return res.status(200).send('OK');
            }
            if (messageText === '/help') {
                 userState[chatId].nonLinkCounter = 0;
                 await sendMessage(chatId, "Platform yang didukung saat ini:\n• Facebook\n• TikTok\n• Instagram\n• Twitter/X\n• Douyin\n\nCara penggunaan:\n1. Salin link video.\n2. Kirim linknya ke saya.\n\nSaya akan coba ambil link unduhannya.", null, messageId);
                 return res.status(200).send('OK');
            }

            const linkInfo = detectLinkType(messageText);

            if (linkInfo) {
                console.log(`[Webhook] Link detected for chat ${chatId}: Type=${linkInfo.type}, URL=${linkInfo.url}`);
                userState[chatId].nonLinkCounter = 0;
                await sendMessage(chatId, `⏳ Sedang memproses link ${linkInfo.type} Anda...`, null, messageId);

                switch (linkInfo.type) {
                    case 'tiktok':
                        await handleTikTokLink(linkInfo.url, chatId, userState); // Pass userState if needed by handler
                        break;
                    case 'instagram': // Panggil handler IG
                        await handleInstagramLink(linkInfo.url, chatId); // Tidak perlu userState
                        break;
                    case 'facebook': await handleFacebookLink(linkInfo.url, chatId); break;
                    case 'twitter': await handleTwitterLink(linkInfo.url, chatId); break;
                    case 'douyin': await handleDouyinLink(linkInfo.url, chatId); break;
                    default:
                        console.warn(`[Webhook] No handler defined for link type: ${linkInfo.type}`);
                        await sendMessage(chatId, `Maaf, saya belum bisa menangani link ${linkInfo.type} saat ini. 🗿`, null, messageId);
                }

            } else {
                 const GENERIC_URL_REGEX = /(https?:\/\/[^\s]+)/gi;
                if (messageText.match(GENERIC_URL_REGEX)) {
                    console.log(`[Webhook] Unsupported Link detected for chat ${chatId}`);
                    userState[chatId].nonLinkCounter = 0;
                    await sendMessage(chatId, "❌ Link tidak didukung.\nPlatform: FB, TT, IG, X, Douyin.\nInfo /help", null, messageId);
                } else {
                    userState[chatId].nonLinkCounter++;
                    const counter = userState[chatId].nonLinkCounter;
                    console.log(`[Webhook] Plain text message (no link) from chat ${chatId}. Counter: ${counter}`);
                    if (counter <= 2) {
                        await sendMessage(chatId, 'Linknya mana bro? (FB/TT/IG/X/Douyin) 🗿', null, messageId);
                    } else if (counter === 3) {
                        await sendMessage(chatId, 'terserah!!🗿', null, messageId);
                    }
                }
            }
        } else {
            userState[chatId].nonLinkCounter++;
            const counter = userState[chatId].nonLinkCounter;
            console.log(`[Webhook] Non-text message from chat ${chatId}. Counter: ${counter}`);
            if (counter <= 2) {
                await sendMessage(chatId, '🗿', null, messageId);
            } else if (counter === 3) {
                await sendMessage(chatId, 'terserah!!🗿', null, messageId);
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('[Webhook] FATAL ERROR in handler:', error);
        if (!res.writableEnded) {
             res.status(200).send('Internal Server Error - Check Logs');
        }
    }
};