// api/webhook.js
const axios = require('axios');
// MODIFIKASI: Impor logger
const logger = require('../lib/utils/logger'); // Pastikan path ini benar

const { detectLinkType } = require('../lib/utils/linkDetector');
const { sendMessage } = require('../lib/utils/telegram'); // Asumsi sendMessage juga akan diupdate atau sudah menggunakan logger
const { handleFacebookLink } = require('../lib/handlers/facebook');
const { handleTikTokLink, getStoredTikTokDescription, clearStoredTikTokDescription } = require('../lib/handlers/tiktok');
const { handleInstagramLink, getStoredInstagramDescription, clearStoredInstagramDescription } = require('../lib/handlers/instagram');
const { handleTwitterLink } = require('../lib/handlers/twitter');
const { handleDouyinLink } = require('../lib/handlers/douyin');

const userState = {}; // Sebaiknya gunakan solusi penyimpanan yang lebih persisten untuk produksi
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const OWNER_TELEGRAM_ID_STRING = process.env.OWNER_TELEGRAM_ID;
let OWNER_TELEGRAM_ID = null;

if (OWNER_TELEGRAM_ID_STRING) {
    OWNER_TELEGRAM_ID = parseInt(OWNER_TELEGRAM_ID_STRING, 10);
    if (isNaN(OWNER_TELEGRAM_ID)) {
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn({ ownerIdString: OWNER_TELEGRAM_ID_STRING, context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID environment variable tidak valid (bukan angka).');
        OWNER_TELEGRAM_ID = null;
    } else {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ownerId: OWNER_TELEGRAM_ID, context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID berhasil dimuat.');
    }
} else {
    // MODIFIKASI: console.warn -> logger.warn
    logger.warn({ context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID environment variable tidak diatur.');
}

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    if (showAlert) payload.show_alert = showAlert;
    try {
        logger.debug({ callbackQueryId, text, showAlert, context: 'answerCallbackQuery' }, 'Attempting to answer callback query');
        await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, payload);
        logger.info({ callbackQueryId, context: 'answerCallbackQuery' }, 'Callback query answered successfully.');
    } catch (error) {
        // MODIFIKASI: console.error -> logger.error
        logger.error({
            err: error, // Objek error lengkap
            callbackQueryId,
            responseData: error.response ? error.response.data : null,
            context: 'answerCallbackQuery'
        }, `Error answering callback query ${callbackQueryId}`);
    }
}

async function handleNonLinkOrMediaMessage(chatId, messageId, currentUserState) {
    currentUserState.nonLinkCounter = (currentUserState.nonLinkCounter || 0) + 1;
    const counter = currentUserState.nonLinkCounter;
    // MODIFIKASI: console.log -> logger.info
    logger.info({ chatId, messageId, nonLinkCounter: counter, context: 'handleNonLinkOrMediaMessage' }, `Non-link/media message. Counter: ${counter}`);
    let replyText = '🗿';
    if (counter <= 2) {
        replyText = 'Linknya mana bro? (FB/TT/IG/X/Douyin) 🗿';
    } else if (counter === 3) {
        replyText = 'terserah!!🗿';
    }
    // Asumsi sendMessage akan di-refactor untuk menggunakan logger atau sudah menggunakannya
    await sendMessage(chatId, replyText, null, messageId);
}

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const callbackQueryId = callbackQuery.id;
    const originalMessageId = callbackQuery.message.message_id;

    // MODIFIKASI: console.log -> logger.info
    logger.info({ callbackData: data, chatId, userId, originalMessageId, context: 'handleCallbackQuery_entry' }, 'Received Callback Query');
    logger.debug({ callbackQueryObj: callbackQuery, context: 'handleCallbackQuery_entry' }, 'Full callback query object');


    let description = null;
    let descriptionType = '';
    let clearFunction = null;
    let targetChatId = chatId; // Inisialisasi targetChatId
    let mediaId = null; // Inisialisasi mediaId
    let actionTaken = false;

    const dataParts = data.split(':');
    const prefix = dataParts[0];

    if (prefix === 'ttdesc' && dataParts.length === 3) {
        targetChatId = dataParts[1]; // String, perlu dipertimbangkan jika chat ID harus number
        mediaId = dataParts[2];
        description = getStoredTikTokDescription(targetChatId, mediaId);
        descriptionType = 'TikTok';
        clearFunction = clearStoredTikTokDescription;
        actionTaken = true;
    } else if (prefix === 'igdesc' && dataParts.length === 3) {
        targetChatId = dataParts[1]; // String
        mediaId = dataParts[2];
        description = getStoredInstagramDescription(targetChatId, mediaId);
        descriptionType = 'Instagram';
        clearFunction = clearStoredInstagramDescription;
        actionTaken = true;
    } else if (data === 'noop') {
        logger.info({ callbackQueryId, data, context: 'handleCallbackQuery' }, 'Callback query is noop, answering silently.');
        await answerCallbackQuery(callbackQueryId);
        return;
    } else {
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn({ callbackData: data, chatId, userId, context: 'handleCallbackQuery' }, 'Unhandled callback_data');
        await answerCallbackQuery(callbackQueryId, 'Aksi tidak dikenal.');
        return;
    }

    if (!actionTaken && !(prefix === 'ttdesc' || prefix === 'igdesc')) {
        // MODIFIKASI: console.warn -> logger.warn
         logger.warn({ callbackData: data, prefix, chatId, context: 'handleCallbackQuery' }, 'Invalid callback data format, no action taken.');
         await answerCallbackQuery(callbackQueryId, 'Error: Data tombol tidak valid.');
         return;
    }

    if (descriptionType && mediaId && clearFunction) {
        if (description) {
            try {
                logger.info({ targetChatId, descriptionType, mediaId, context: 'handleCallbackQuery' }, `Sending ${descriptionType} description.`);
                await sendMessage(targetChatId, `📝 *Deskripsi Lengkap (${descriptionType}):*\n\n${description}`, { parse_mode: 'Markdown' }, originalMessageId); // Menambahkan parse_mode
                // MODIFIKASI: console.log -> logger.info
                logger.info({ descriptionType, targetChatId, mediaId, context: 'handleCallbackQuery' }, `Sent ${descriptionType} description.`);
                await answerCallbackQuery(callbackQueryId);
                clearFunction(targetChatId, mediaId); // Pastikan targetChatId sesuai tipenya dengan yang disimpan
            } catch (sendError) {
                // MODIFIKASI: console.error -> logger.error
                logger.error({ err: sendError, descriptionType, targetChatId, mediaId, context: 'handleCallbackQuery' }, `Error sending ${descriptionType} description message`);
                await answerCallbackQuery(callbackQueryId, 'Gagal mengirim deskripsi.', true);
                clearFunction(targetChatId, mediaId);
            }
        } else {
            // MODIFIKASI: console.warn -> logger.warn
            logger.warn({ descriptionType, targetChatId, mediaId, context: 'handleCallbackQuery' }, `No stored ${descriptionType} description for callback`);
            await answerCallbackQuery(callbackQueryId, 'Deskripsi sudah ditampilkan atau tidak tersedia lagi.');
        }
    } else if (actionTaken) { // Berarti prefix dikenali tapi salah satu (descriptionType, mediaId, clearFunction) tidak diset
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn({ callbackData: data, descriptionType, mediaId, hasClearFunction: !!clearFunction, context: 'handleCallbackQuery' }, 'Incomplete setup for recognized callback prefix.');
        await answerCallbackQuery(callbackQueryId, 'Error memproses permintaan deskripsi.');
    }
    // Jika !actionTaken sudah ditangani di atas.
}

module.exports = async (req, res) => {
    // MODIFIKASI: Log setiap request yang masuk ke webhook handler utama
    const update = req.body;
    const updateId = update?.update_id;
    const messageId = update?.message?.message_id || update?.callback_query?.message?.message_id;
    const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
    const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
    const updateType = update?.message ? 'message' : (update?.callback_query ? 'callback_query' : 'unknown');

    logger.info(
        { updateId, messageId, chatId, userId, updateType, url: req.url, method: req.method, context: 'webhookHandler_entry' },
        `Webhook handler received a request. Type: ${updateType}`
    );
    logger.debug({ updateObj: update, context: 'webhookHandler_entry' }, 'Full update object received');


    if (req.method !== 'POST') {
        logger.warn({ method: req.method, url: req.url, ip: req.ip, context: 'webhookHandler_entry' }, 'Method Not Allowed');
        return res.status(405).send('Method Not Allowed');
    }

    try {
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            // Tidak perlu send 'OK' di sini karena handleCallbackQuery akan memanggil answerCallbackQuery
            // dan respons HTTP 200 sudah cukup, Telegram tidak butuh body 'OK' untuk callback.
            // Cukup pastikan answerCallbackQuery dipanggil.
            return res.status(200).send(); // Kirim respons HTTP 200 kosong
        }

        if (!update.message) {
            // MODIFIKASI: console.log -> logger.info
            logger.info({ updateId, updateKeys: Object.keys(update), context: 'webhookHandler_entry' }, 'Not a message or callback query update, ignoring.');
            return res.status(200).send('OK'); // Respons OK untuk update yang tidak relevan
        }

        // Variabel message, chatId, messageText, messageId sudah dideklarasikan di atas dari `update`
        const message = update.message; // Ambil objek message dari update
        const messageText = message.text; // Ambil teks pesan

        // userState initialization
        if (!userState[chatId]) {
            logger.debug({ chatId, context: 'userState_init' }, 'Initializing user state for new chat ID.');
            userState[chatId] = { nonLinkCounter: 0 };
        }
        const currentUserState = userState[chatId];

        if (messageText) {
            const commandText = messageText.toLowerCase();
            logger.debug({ chatId, userId, commandText, context: 'messageHandler' }, 'Processing message text.');

            if (commandText === '/start') {
                currentUserState.nonLinkCounter = 0;
                logger.info({ chatId, userId, command: '/start', context: 'commandHandler' }, '/start command received.');
                await sendMessage(chatId, "Selamat datang! 👋 Kirimkan saya link video dari Facebook, TikTok, Instagram, Twitter/X, atau Douyin!", null, messageId);
            } else if (commandText === '/help') {
                currentUserState.nonLinkCounter = 0;
                logger.info({ chatId, userId, command: '/help', context: 'commandHandler' }, '/help command received.');
                await sendMessage(chatId, "Platform yang didukung saat ini:\n• Facebook\n• TikTok\n• Instagram\n• Twitter/X\n• Douyin\n\nCara penggunaan:\n1. Salin link video.\n2. Kirim linknya ke saya.\n\nSaya akan coba ambil link unduhannya.", null, messageId);
            } else if (commandText === '/ai') {
                if (OWNER_TELEGRAM_ID && chatId === OWNER_TELEGRAM_ID) {
                    currentUserState.nonLinkCounter = 0;
                    // MODIFIKASI: console.log -> logger.info
                    logger.info({ chatId, userId, command: '/ai', authorized: true, context: 'commandHandler' }, 'Perintah /ai dijalankan oleh Owner.');
                    await sendMessage(chatId, "🤖 Halo Owner! Perintah /ai sedang dalam pengembangan. Apa yang bisa saya bantu?", null, messageId);
                } else {
                    // MODIFIKASI: console.log -> logger.warn
                    logger.warn({ chatId, userId, command: '/ai', authorized: false, context: 'commandHandler' }, 'Pengguna mencoba mengakses perintah /ai tanpa otorisasi.');
                    await sendMessage(chatId, "🔒 Perintah ini khusus untuk Owner dan Admin yang bisa mengakses perintah ini.", null, messageId);
                }
            } else {
                const linkInfo = detectLinkType(messageText);
                if (linkInfo) {
                    // MODIFIKASI: console.log -> logger.info
                    logger.info({ chatId, userId, linkType: linkInfo.type, url: linkInfo.url, context: 'linkHandler_detected' }, 'Link detected.');
                    currentUserState.nonLinkCounter = 0;
                    // Pertimbangkan apakah log "Tunggu Sebentar" dan "⏳" ini perlu. Mungkin bisa dihilangkan atau dijadikan debug.
                    await sendMessage(chatId, "Tunggu Sebentar Sedang Diproses...", null, messageId);
                     await sendMessage(chatId, "⏳", null, null); // Emoji loading mungkin tidak perlu jika proses cepat

                    switch (linkInfo.type) {
                        case 'tiktok': await handleTikTokLink(linkInfo.url, chatId, currentUserState); break;
                        case 'instagram': await handleInstagramLink(linkInfo.url, chatId); break;
                        case 'facebook': await handleFacebookLink(linkInfo.url, chatId); break;
                        case 'twitter': await handleTwitterLink(linkInfo.url, chatId); break;
                        case 'douyin': await handleDouyinLink(linkInfo.url, chatId); break;
                        default:
                            // MODIFIKASI: console.warn -> logger.warn
                            logger.warn({ chatId, userId, linkType: linkInfo.type, url: linkInfo.url, context: 'linkHandler_unhandled' }, 'No specific handler defined for detected link type.');
                            await sendMessage(chatId, `Maaf, saya belum bisa menangani link ${linkInfo.type} saat ini. 🗿`, null, messageId);
                    }
                } else {
                    const GENERIC_URL_REGEX = /(https?:\/\/[^\s]+)/gi;
                    if (messageText.match(GENERIC_URL_REGEX)) {
                        // MODIFIKASI: console.log -> logger.info
                        logger.info({ chatId, userId, messageTextSnippet: messageText.substring(0, 50), context: 'linkHandler_unsupported' }, 'Unsupported Link detected (generic URL).');
                        currentUserState.nonLinkCounter = 0; // Reset counter untuk link tak dikenal juga
                        await sendMessage(chatId, "❌ Link tidak didukung.\nPlatform: FB, TT, IG, X, Douyin.\nInfo /help", null, messageId);
                    } else {
                        await handleNonLinkOrMediaMessage(chatId, messageId, currentUserState);
                    }
                }
            }
        } else { // Tidak ada messageText (misalnya, foto, stiker, dll.)
            logger.info({chatId, userId, messageType: message.sticker ? 'sticker' : (message.photo ? 'photo' : 'other_media'), context: 'messageHandler_noText'}, 'Received message without text (media/sticker etc.).')
            await handleNonLinkOrMediaMessage(chatId, messageId, currentUserState);
        }
        // Respons OK dikirim di akhir jika tidak ada error dan bukan callback query
        if (!res.writableEnded) { // Pastikan respons belum dikirim (misalnya oleh callback handler)
             res.status(200).send('OK');
        }

    } catch (error) {
        // MODIFIKASI: console.error -> logger.error
        logger.error({
            err: error, // Objek error lengkap
            updateId,
            chatId,
            userId,
            updateType,
            context: 'webhookHandler_fatalError'
        }, 'FATAL ERROR in webhook handler');

        // Kirim respons generik ke Telegram agar tidak timeout jika belum ada respons terkirim
        if (!res.headersSent && !res.writableEnded) {
            res.status(500).send('Internal Server Error - Check Logs'); // Kirim 500 jika terjadi error tak terduga
        } else if (!res.writableEnded) {
            // Jika headers sudah terkirim tapi body belum, coba kirim pesan error sederhana.
            // Ini jarang terjadi jika menggunakan res.status().send() dengan benar.
            res.end();
        }
    }
};
