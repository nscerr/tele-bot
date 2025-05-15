// lib/handlers/facebook.js
const axios = require('axios');
const he = require('he');
const { formatDuration } = require('../utils/time');
// Impor trySendMedia dan sendMessage, BUKAN sendFormattedResult
const { sendMessage, trySendMedia } = require('../utils/telegram');

const FB_DOWNLOADER_API = 'https://api.ferdev.my.id/downloader/facebook';
const API_TIMEOUT = 20000;

// Fungsi buildButtonGrid TIDAK ADA di sini (sesuai permintaan Anda)

async function handleFacebookLink(extractedLink, chatId) {
    try {
        const apiUrl = `${FB_DOWNLOADER_API}?link=${encodeURIComponent(extractedLink)}`;
        console.log(`[FB Handler] Calling Downloader API for chat ${chatId}: ${apiUrl}`);
        const downloaderResponse = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        console.log(`[FB Handler] Downloader API Response for chat ${chatId}:`, downloaderResponse.data);

        if (downloaderResponse.data && downloaderResponse.data.succes) {
            const videoData = downloaderResponse.data.data;

            // --- Logika Pengiriman Hasil Langsung Menggunakan trySendMedia ---
            const decodedTitle = videoData.title ? he.decode(videoData.title) : 'Video Facebook';
            const durationFormatted = formatDuration(videoData.duration_ms);
            // Caption DENGAN format * dan _ (tanpa escape manual)
            const caption = `🎬 *JUDUL:* ${decodedTitle}\n⏱️ *DURASI:* ${durationFormatted}`;

            // Kumpulkan tombol ke array of arrays (vertikal)
            const buttons = [];
            if (videoData.hd) buttons.push([{ text: 'Unduh HD 🎬', url: videoData.hd }]);
            if (videoData.sd) buttons.push([{ text: 'Unduh SD 📱', url: videoData.sd }]);
            // Tambahkan tombol thumbnail jika ada dan berbeda
            if (videoData.thumbnail && videoData.thumbnail !== videoData.hd && videoData.thumbnail !== videoData.sd) {
                buttons.push([{ text: 'Thumbnail 🖼️', url: videoData.thumbnail }]);
            }
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null; // Markup vertikal standar

            let sentSuccessfully = false;
            const videoUrlToSend = videoData.hd || videoData.sd; // Prioritaskan HD

            // Coba kirim video utama (HD atau SD)
            if (!sentSuccessfully && videoUrlToSend) {
                 // Panggil trySendMedia langsung
                 sentSuccessfully = await trySendMedia(chatId, 'video', videoUrlToSend, caption, replyMarkup);
            }

            // Fallback ke thumbnail jika video gagal dan thumbnail ada
            if (!sentSuccessfully && videoData.thumbnail) {
                 const thumbCaption = `🖼️ Thumbnail untuk:\n\n${decodedTitle}\n⏱️ *DURASI:* ${durationFormatted}`;
                 // Panggil trySendMedia untuk thumbnail
                 const thumbSent = await trySendMedia(chatId, 'photo', videoData.thumbnail, thumbCaption, null); // Kirim thumb tanpa tombol
                 if (thumbSent && replyMarkup) {
                     await sendMessage(chatId, "Tombol Unduhan:", replyMarkup); // Kirim tombol setelah thumb
                     sentSuccessfully = true; // Anggap berhasil karena thumb+tombol terkirim
                 }
            }

            // Fallback terakhir ke teks jika semua gagal
            if (!sentSuccessfully) {
                 if (replyMarkup) {
                     await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                 } else {
                     await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
                 }
            }
            // --- Akhir Logika Pengiriman Hasil ---

        } else {
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
        await sendMessage(chatId, errorText); // sendMessage akan handle fallback jika error parse
    }
}

module.exports = {
    handleFacebookLink
};