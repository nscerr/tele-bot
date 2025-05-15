// lib/handlers/twitter.js
const axios = require('axios');
const { sendMessage, trySendMedia } = require('../utils/telegram');

const TWITTER_API_ENDPOINT = 'https://api.ferdev.my.id/downloader/twitter';
const API_TIMEOUT = 25000; // Mungkin perlu waktu lebih lama?

async function handleTwitterLink(extractedLink, chatId) {
    try {
        const apiUrl = `${TWITTER_API_ENDPOINT}?link=${encodeURIComponent(extractedLink)}`;
        console.log(`[Twitter Handler] Calling API for chat ${chatId}: ${apiUrl}`);
        const response = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        console.log(`[Twitter Handler] API Response for chat ${chatId}:`, response.data);

        if (response.data && response.data.success) {
            const result = response.data.result;
            const hdUrl = result?.HD?.url;
            const semiHdUrl = result?.SEMI_HD?.url;
            const sdUrl = result?.SD?.url;

            if (!hdUrl && !semiHdUrl && !sdUrl) {
                await sendMessage(chatId, '❌ Maaf, API Twitter berhasil merespons tapi tidak menemukan link video. 🗿');
                return;
            }

            // Siapkan tombol
            const buttons = [];
            if (hdUrl) buttons.push([{ text: 'Unduh Full HD 🎬', url: hdUrl }]);
            if (semiHdUrl) buttons.push([{ text: 'Unduh HD 🎥', url: semiHdUrl }]);
            if (sdUrl) buttons.push([{ text: 'Unduh SD 📱', url: sdUrl }]);
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

            const caption = `✅ Link download video Twitter/X ditemukan:`;
            let sentSuccessfully = false;

            // Percobaan kirim: HD -> SEMI_HD -> SD
            if (!sentSuccessfully && hdUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'video', hdUrl, caption, replyMarkup);
            }
            if (!sentSuccessfully && semiHdUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'video', semiHdUrl, caption, replyMarkup);
            }
            if (!sentSuccessfully && sdUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'video', sdUrl, caption, replyMarkup);
            }

            // Fallback jika semua gagal
            if (!sentSuccessfully) {
                if (replyMarkup) {
                    await sendMessage(chatId, `⚠️ Gagal mengirim video langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                } else {
                    await sendMessage(chatId, `❌ Gagal mengirim video dan tidak ada link unduhan. 🗿`);
                }
            }

        } else {
            const errorMessage = response.data.message || 'Gagal mengambil link video Twitter/X.';
            await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader Twitter/X: ${errorMessage} 🗿`);
        }
    } catch (apiError) {
        console.error(`[Twitter Handler] Error calling API for chat ${chatId}:`, apiError.message);
        let errorText = '❌ Maaf, terjadi kesalahan internal saat mencoba mengambil link video Twitter/X. 🗿';
        if (apiError.code === 'ECONNABORTED') {
            errorText = '❌ Maaf, server downloader Twitter/X terlalu lama merespons. 🗿';
        } else if (apiError.response && apiError.response.data && apiError.response.data.message) {
            errorText = `❌ Maaf, terjadi kesalahan saat menghubungi server downloader Twitter/X: ${apiError.response.data.message} 🗿`;
        }
        await sendMessage(chatId, errorText);
    }
}

module.exports = { handleTwitterLink };