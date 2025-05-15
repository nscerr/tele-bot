// lib/handlers/douyin.js
const axios = require('axios');
const he = require('he');
const { sendMessage, trySendMedia } = require('../utils/telegram');

const DOUYIN_API_ENDPOINT = 'https://api.ferdev.my.id/downloader/douyin';
const API_TIMEOUT = 25000;

async function handleDouyinLink(extractedLink, chatId) {
    try {
        const apiUrl = `${DOUYIN_API_ENDPOINT}?link=${encodeURIComponent(extractedLink)}`;
        console.log(`[Douyin Handler] Calling API for chat ${chatId}: ${apiUrl}`);
        const response = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        console.log(`[Douyin Handler] API Response for chat ${chatId}:`, response.data);

        const isSuccess = response.data && response.data.success;

        if (isSuccess && response.data.result && response.data.result.download) {
            const result = response.data.result;
            const videoUrl = result.download.no_watermark;
            const thumbnailUrl = result.thumbnail;
            const audioUrl = result.download.mp3;
            const title = result.title ? he.decode(result.title) : 'Video Douyin';

            if (!videoUrl && !thumbnailUrl) {
                await sendMessage(chatId, '❌ Maaf, API Douyin berhasil merespons tapi tidak menemukan link video atau thumbnail. 🗿');
                return;
            }

            const caption = `🇨🇳 **JUDUL:** ${title}`;

            // Buat tombol
            const buttons = [];
            if (videoUrl) buttons.push([{ text: 'Unduh Video (Tanpa WM) ✨', url: videoUrl }]);
            if (thumbnailUrl) buttons.push([{ text: 'Unduh Cover 🖼️', url: thumbnailUrl }]);
            if (audioUrl) buttons.push([{ text: 'Unduh Audio 🎵', url: audioUrl }]);
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

            let sentSuccessfully = false;

            // Percobaan kirim: Video -> Thumbnail
            if (!sentSuccessfully && videoUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'video', videoUrl, caption, replyMarkup);
            }
            if (!sentSuccessfully && thumbnailUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'photo', thumbnailUrl, caption, replyMarkup);
            }

            // Fallback jika semua gagal
            if (!sentSuccessfully) {
                 if (replyMarkup) {
                     await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                 } else {
                     await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
                 }
            }

        } else {
            const errorMessage = response.data.message || 'Gagal mengambil link Douyin.';
            await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader Douyin: ${errorMessage} 🗿`);
        }
    } catch (apiError) {
        console.error(`[Douyin Handler] Error calling API for chat ${chatId}:`, apiError.message);
        let errorText = '❌ Maaf, terjadi kesalahan internal saat mencoba mengambil link Douyin. 🗿';
        if (apiError.code === 'ECONNABORTED') {
            errorText = '❌ Maaf, server downloader Douyin terlalu lama merespons. 🗿';
        } else if (apiError.response && apiError.response.data && apiError.response.data.message) {
            errorText = `❌ Maaf, terjadi kesalahan saat menghubungi server downloader Douyin: ${apiError.response.data.message} 🗿`;
        }
        await sendMessage(chatId, errorText);
    }
}

module.exports = { handleDouyinLink };