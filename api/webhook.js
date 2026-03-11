// api/webhook.js
const axios = require('axios');
const logger = require('../lib/utils/logger');
const { detectLinkType } = require('../lib/utils/linkDetector');
const { sendMessage } = require('../lib/utils/telegram');
const { extractMedia, checkApiHealth } = require('../lib/services/downloader');
const { uploadMediaUrls } = require('../lib/services/uploader');
const { sendMedia, getStoredDescription, clearStoredDescription } = require('../lib/services/mediaSender');
const R = require('../lib/utils/responses');

const userState = {};
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const OWNER_TELEGRAM_ID_STRING = process.env.OWNER_TELEGRAM_ID;
let OWNER_TELEGRAM_ID = null;

if (OWNER_TELEGRAM_ID_STRING) {
    OWNER_TELEGRAM_ID = parseInt(OWNER_TELEGRAM_ID_STRING, 10);
    if (isNaN(OWNER_TELEGRAM_ID)) {
        logger.warn({ ownerIdString: OWNER_TELEGRAM_ID_STRING, context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID tidak valid (bukan angka).');
        OWNER_TELEGRAM_ID = null;
    } else {
        logger.info({ ownerId: OWNER_TELEGRAM_ID, context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID berhasil dimuat.');
    }
} else {
    logger.warn({ context: 'OWNER_ID_SETUP' }, 'OWNER_TELEGRAM_ID environment variable tidak diatur.');
}

// --- Helper Functions ---

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    if (showAlert) payload.show_alert = showAlert;
    try {
        await axios.post(`${TELEGRAM_API_BASE_URL}/answerCallbackQuery`, payload);
    } catch (error) {
        logger.error({ err: error, callbackQueryId, context: 'answerCallbackQuery' }, 'Error answering callback query.');
    }
}

async function handleNonLinkOrMediaMessage(chatId, messageId, currentUserState) {
    currentUserState.nonLinkCounter = (currentUserState.nonLinkCounter || 0) + 1;
    const counter = currentUserState.nonLinkCounter;
    logger.info({ chatId, messageId, nonLinkCounter: counter, context: 'handleNonLinkOrMediaMessage' }, `Non-link message. Counter: ${counter}`);

    let replyText = R.NON_LINK_DEFAULT;
    if (counter <= 2) {
        replyText = R.NON_LINK_ASK;
    } else if (counter === 3) {
        replyText = R.NON_LINK_FED_UP;
    }
    await sendMessage(chatId, replyText, null, messageId);
}

// --- Callback Query Handler ---

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const callbackQueryId = callbackQuery.id;
    const originalMessageId = callbackQuery.message.message_id;

    logger.info({ callbackData: data, chatId, userId, context: 'handleCallbackQuery' }, 'Received Callback Query.');

    // Format: desc:{chatId}:{mediaId}
    if (data === 'noop') {
        await answerCallbackQuery(callbackQueryId);
        return;
    }

    const dataParts = data.split(':');
    if (dataParts[0] === 'desc' && dataParts.length === 3) {
        const targetChatId = dataParts[1];
        const mediaId = dataParts[2];
        const description = getStoredDescription(targetChatId, mediaId);

        if (description) {
            try {
                await sendMessage(targetChatId, description, null, originalMessageId);
                logger.info({ targetChatId, mediaId, context: 'handleCallbackQuery' }, 'Deskripsi lengkap terkirim.');
                await answerCallbackQuery(callbackQueryId);
                clearStoredDescription(targetChatId, mediaId);
            } catch (sendError) {
                logger.error({ err: sendError, targetChatId, mediaId, context: 'handleCallbackQuery' }, 'Error mengirim deskripsi.');
                await answerCallbackQuery(callbackQueryId, R.CB_DESC_FAILED, true);
                clearStoredDescription(targetChatId, mediaId);
            }
        } else {
            logger.warn({ targetChatId, mediaId, context: 'handleCallbackQuery' }, 'Deskripsi tidak ditemukan.');
            await answerCallbackQuery(callbackQueryId, R.CB_DESC_NOT_FOUND);
        }
    } else {
        logger.warn({ callbackData: data, chatId, context: 'handleCallbackQuery' }, 'Unhandled callback_data.');
        await answerCallbackQuery(callbackQueryId, R.CB_UNKNOWN_ACTION);
    }
}

// --- Link Processing (Unified Flow) ---

async function processLink(chatId, messageId, linkInfo) {
    const { type: platform, url } = linkInfo;
    const logContext = { chatId, platform, url, context: 'processLink' };

    logger.info(logContext, `Memproses link ${platform}.`);
    await sendMessage(chatId, R.PROCESSING, null, messageId);

    // Step 1: Extract media dari TFX API
    const result = await extractMedia(platform, url);

    if (!result.success || !result.data) {
        const errorMsg = result.errorMessage || 'Gagal mengambil data dari server downloader.';
        logger.error({ ...logContext, errorMsg }, 'Gagal extract media.');
        await sendMessage(chatId, R.EXTRACT_FAILED(errorMsg));
        return;
    }

    // Cek jika tidak ada media (semua link null dan images null)
    const data = result.data;
    if (!data.linkMp4 && !data.linkHd && (!data.images || data.images.length === 0)) {
        logger.warn({ ...logContext, status: data.status }, 'API sukses tapi tidak ada media.');
        await sendMessage(chatId, R.NO_MEDIA_FOUND);
        return;
    }

    // Step 2: Upload semua media ke uguu.se (got-scraping bypass CDN anti-bot)
    const uploadedUrls = await uploadMediaUrls(data, platform);

    // Step 3: Kirim media ke Telegram
    await sendMedia(chatId, data, uploadedUrls, platform);
}

// --- Main Webhook Handler ---

module.exports = async (req, res) => {
    const update = req.body;
    const updateId = update?.update_id;
    const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
    const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
    const updateType = update?.message ? 'message' : (update?.callback_query ? 'callback_query' : 'unknown');

    logger.info({ updateId, chatId, userId, updateType, method: req.method, context: 'webhookHandler' }, `Webhook request. Type: ${updateType}`);

    if (req.method !== 'POST') {
        logger.warn({ method: req.method, context: 'webhookHandler' }, 'Method Not Allowed.');
        return res.status(405).send('Method Not Allowed');
    }

    try {
        // Handle callback queries
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return res.status(200).send();
        }

        // Ignore non-message updates
        if (!update.message) {
            logger.info({ updateId, context: 'webhookHandler' }, 'Not a message or callback query, ignoring.');
            return res.status(200).send('OK');
        }

        const message = update.message;
        const messageText = message.text;
        const messageId = message.message_id;

        // Init user state
        if (!userState[chatId]) {
            userState[chatId] = { nonLinkCounter: 0 };
        }
        const currentUserState = userState[chatId];

        if (messageText) {
            const commandText = messageText.toLowerCase();

            // --- Commands ---
            if (commandText === '/start') {
                currentUserState.nonLinkCounter = 0;
                logger.info({ chatId, command: '/start', context: 'commandHandler' }, '/start command.');
                await sendMessage(chatId, R.CMD_START, null, messageId);

            } else if (commandText === '/help') {
                currentUserState.nonLinkCounter = 0;
                logger.info({ chatId, command: '/help', context: 'commandHandler' }, '/help command.');
                await sendMessage(chatId, R.CMD_HELP, null, messageId);

            } else if (commandText === '/ai') {
                if (OWNER_TELEGRAM_ID && chatId === OWNER_TELEGRAM_ID) {
                    currentUserState.nonLinkCounter = 0;
                    logger.info({ chatId, command: '/ai', authorized: true, context: 'commandHandler' }, '/ai command oleh Owner.');
                    await sendMessage(chatId, R.CMD_AI_OWNER, null, messageId);
                } else {
                    logger.warn({ chatId, userId, command: '/ai', authorized: false, context: 'commandHandler' }, '/ai tanpa otorisasi.');
                    await sendMessage(chatId, R.CMD_AI_DENIED, null, messageId);
                }

            } else if (commandText === '/health') {
                currentUserState.nonLinkCounter = 0;
                logger.info({ chatId, command: '/health', context: 'commandHandler' }, '/health command.');
                await sendMessage(chatId, R.CMD_HEALTH_CHECKING, null, messageId);

                const health = await checkApiHealth();
                if (health.ok) {
                    const uptimeSeconds = Math.floor(health.uptime);
                    const hours = Math.floor(uptimeSeconds / 3600);
                    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                    const seconds = uptimeSeconds % 60;
                    const uptimeStr = `${hours}j ${minutes}m ${seconds}d`;
                    await sendMessage(chatId, R.CMD_HEALTH_ONLINE(uptimeStr), null, messageId);
                } else {
                    await sendMessage(chatId, R.CMD_HEALTH_OFFLINE, null, messageId);
                }

            } else {
                // --- Link Detection ---
                const linkInfo = detectLinkType(messageText);
                if (linkInfo) {
                    currentUserState.nonLinkCounter = 0;
                    await processLink(chatId, messageId, linkInfo);
                } else {
                    // Check if it's an unsupported URL
                    const GENERIC_URL_REGEX = /(https?:\/\/[^\s]+)/gi;
                    if (messageText.match(GENERIC_URL_REGEX)) {
                        currentUserState.nonLinkCounter = 0;
                        logger.info({ chatId, context: 'linkHandler_unsupported' }, 'Unsupported URL detected.');
                        await sendMessage(chatId, R.LINK_UNSUPPORTED, null, messageId);
                    } else {
                        await handleNonLinkOrMediaMessage(chatId, messageId, currentUserState);
                    }
                }
            }
        } else {
            // Non-text message (photo, sticker, etc.)
            logger.info({ chatId, context: 'messageHandler_noText' }, 'Received non-text message.');
            await handleNonLinkOrMediaMessage(chatId, messageId, currentUserState);
        }

        if (!res.writableEnded) {
            res.status(200).send('OK');
        }

    } catch (error) {
        logger.error({ err: error, updateId, chatId, userId, context: 'webhookHandler_fatalError' }, 'FATAL ERROR in webhook handler.');

        if (!res.headersSent && !res.writableEnded) {
            res.status(500).send('Internal Server Error');
        } else if (!res.writableEnded) {
            res.end();
        }
    }
};
