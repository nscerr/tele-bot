// lib/handlers/facebook.js
const axios = require('axios');
const he = require('he');
const { formatDuration } = require('../utils/time');
// Impor trySendMedia dan sendMessage, BUKAN sendFormattedResult
const { sendMessage, trySendMedia } = require('../utils/telegram');
// MODIFIKASI: Impor logger
const logger = require('../utils/logger'); // Pastikan path ini benar

// PERBAIKI: Update endpoint API Facebook
const FB_DOWNLOADER_API = 'https://mdown-xi.vercel.app/fbdown';
const API_TIMEOUT = 20000;

// HAPUS: API key tidak lagi diperlukan untuk endpoint baru
// const FB_API_KEY = 'key-rixzi'; 

async function handleFacebookLink(extractedLink, chatId) {
    const logContext = { extractedLink, chatId, context: 'handleFacebookLink_entry' };
    logger.info(logContext, 'Memulai penanganan link Facebook.');
    
    try {
        // PERBAIKI: Update format URL API
        const apiUrl = `${FB_DOWNLOADER_API}?url=${encodeURIComponent(extractedLink)}`;
        
        logger.info({ ...logContext, apiUrlRequest: apiUrl }, `Calling Facebook Downloader API for chat ${chatId}`);
        const downloaderResponse = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        logger.debug({ ...logContext, responseData: downloaderResponse.data }, `Facebook Downloader API Response for chat ${chatId}`);

        // PERBAIKI: Sesuaikan dengan struktur respons baru
        if (downloaderResponse.data && downloaderResponse.data.status === "Sukses") {
            const links = downloaderResponse.data.links || [];
            
            // PERBAIKI: Ekstrak data dari struktur baru
            const hdLink = links.find(link => link.quality.includes('HD') || link.quality.includes('720p'));
            const sdLink = links.find(link => link.quality.includes('SD') || link.quality.includes('360p'));
            
            // PERBAIKI: API baru tidak menyediakan judul atau durasi, gunakan default
            const decodedTitle = 'Video Facebook';
            const durationFormatted = 'N/A';
            
            const caption = `🎬 *JUDUL:* ${decodedTitle}\n⏱️ *DURASI:* ${durationFormatted}`;

            const buttons = [];
            if (hdLink) buttons.push([{ text: `Unduh ${hdLink.quality} 🎬`, url: hdLink.url }]);
            if (sdLink) buttons.push([{ text: `Unduh ${sdLink.quality} 📱`, url: sdLink.url }]);
            
            // PERBAIKI: API baru tidak menyediakan thumbnail
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

            let sentSuccessfully = false;
            const videoUrlToSend = hdLink ? hdLink.url : (sdLink ? sdLink.url : null);

            if (videoUrlToSend) {
                sentSuccessfully = await trySendMedia(chatId, 'video', videoUrlToSend, caption, replyMarkup);
            }

            if (!sentSuccessfully && replyMarkup) {
                logger.warn({ ...logContext, action: 'sentButtonsAsFallback' }, 'Gagal mengirim media, mengirim tombol sebagai fallback.');
                await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
            } else if (!sentSuccessfully) {
                logger.error({ ...logContext, action: 'sentErrorMessage' }, 'Gagal mengirim media dan tidak ada tombol unduhan.');
                await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
            }

        } else {
            // PERBAIKI: Sesuaikan dengan format error baru
            const errorMessage = downloaderResponse.data ? downloaderResponse.data.pesan : 'Gagal mengambil link video FB.';
            logger.error({ ...logContext, errorMessage, responseData: downloaderResponse.data }, `Facebook Downloader API returned failure for chat ${chatId}`);
            await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader FB: ${errorMessage} 🗿`);
        }
    } catch (apiError) {
        logger.error({ ...logContext, err: apiError }, `Error calling Facebook Downloader API for chat ${chatId}`);
        let errorText = '❌ Maaf, terjadi kesalahan internal saat mencoba mengambil link video FB. 🗿';
        if (apiError.code === 'ECONNABORTED') {
            errorText = '❌ Maaf, server downloader FB terlalu lama merespons. Coba lagi nanti. 🗿';
        } else if (apiError.response && apiError.response.data && apiError.response.data.pesan) {
            // PERBAIKI: Sesuaikan dengan format error baru
            errorText = `❌ Maaf, terjadi kesalahan saat menghubungi server downloader FB: ${apiError.response.data.pesan} 🗿`;
        }
        await sendMessage(chatId, errorText);
    }
}

module.exports = {
    handleFacebookLink
};
