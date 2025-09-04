// lib/handlers/facebook.js
const axios = require('axios');
const he = require('he');
const { formatDuration } = require('../utils/time');
// Impor trySendMedia dan sendMessage, BUKAN sendFormattedResult
const { sendMessage, trySendMedia } = require('../utils/telegram');

const FB_DOWNLOADER_API = 'https://api.ferdev.my.id/downloader/facebook';
const API_TIMEOUT = 20000;

// Ganti 'key-rixzi' dengan API Key yang Anda dapatkan dari admin.
const FB_API_KEY = 'key-rixzi'; 

async function handleFacebookLink(extractedLink, chatId) {
    try {
        const apiUrl = `${FB_DOWNLOADER_API}?link=${encodeURIComponent(extractedLink)}&apikey=${FB_API_KEY}`;
        
        console.log(`[FB Handler] Calling Downloader API for chat ${chatId}: ${apiUrl}`);
        const downloaderResponse = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        console.log(`[FB Handler] Downloader API Response for chat ${chatId}:`, downloaderResponse.data);

        // --- PERBAIKAN 1: Typo 'succes' menjadi 'success' ---
        if (downloaderResponse.data && downloaderResponse.data.success) { // Diubah dari .succes
            const videoData = downloaderResponse.data.data;

            const decodedTitle = videoData.title ? he.decode(videoData.title) : 'Video Facebook';
            
            // --- PERBAIKAN 2: Penanganan jika durasi tidak ada ---
            // Cek apakah videoData.duration_ms ada, jika tidak, tampilkan 'N/A'
            const durationFormatted = videoData.duration_ms ? formatDuration(videoData.duration_ms) : 'N/A';
            
            const caption = `🎬 *JUDUL:* ${decodedTitle}\n⏱️ *DURASI:* ${durationFormatted}`;

            const buttons = [];
            if (videoData.hd) buttons.push([{ text: 'Unduh HD 🎬', url: videoData.hd }]);
            if (videoData.sd) buttons.push([{ text: 'Unduh SD 📱', url: videoData.sd }]);
            if (videoData.thumbnail && videoData.thumbnail !== videoData.hd && videoData.thumbnail !== videoData.sd) {
                buttons.push([{ text: 'Thumbnail 🖼️', url: videoData.thumbnail }]);
            }
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

            let sentSuccessfully = false;
            const videoUrlToSend = videoData.hd || videoData.sd;

            if (!sentSuccessfully && videoUrlToSend) {
                 sentSuccessfully = await trySendMedia(chatId, 'video', videoUrlToSend, caption, replyMarkup);
            }

            if (!sentSuccessfully && videoData.thumbnail) {
                const thumbCaption = `🖼️ Thumbnail untuk:\n\n${decodedTitle}\n⏱️ *DURASI:* ${durationFormatted}`;
                const thumbSent = await trySendMedia(chatId, 'photo', videoData.thumbnail, thumbCaption, null);
                if (thumbSent && replyMarkup) {
                    await sendMessage(chatId, "Tombol Unduhan:", replyMarkup);
                    sentSuccessfully = true;
                }
            }

            if (!sentSuccessfully) {
                if (replyMarkup) {
                    await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                } else {
                    await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
                }
            }

        } else {
            // Logika ini sekarang akan berjalan dengan benar jika API benar-benar gagal
            const errorMessage = downloaderResponse.data.message || 'Gagal mengambil link video FB.';
            console.error(`[FB Handler] Downloader API returned failure for chat ${chatId}:`, errorMessage);
            await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader FB: ${errorMessage} 🗿`);
        }
    } catch (apiError) {
        console.error(`[FB Handler] Error calling downloader API for chat ${chatId}:`, apiError.message);
        let errorText = '❌ Maaf, terjadi kesalahan internal saat mencoba mengambil link video FB. 🗿';
        if (apiError.code === 'ECONNABORTED') {
            errorText = '❌ Maaf, server downloader FB terlalu lama merespons. Coba lagi nanti. 🗿';
        } else if (apiError.response && apiError.response.data && apiError.response.data.message) {
            errorText = `❌ Maaf, terjadi kesalahan saat menghubungi server downloader FB: ${apiError.response.data.message} 🗿`;
        }
        await sendMessage(chatId, errorText);
    }
}

module.exports = {
    handleFacebookLink
};
