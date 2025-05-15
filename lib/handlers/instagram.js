// lib/handlers/instagram.js
const axios = require('axios');
const he = require('he');
const { timestampToDate } = require('../utils/time');
const { sendMessage, trySendMedia, sendAlbum } = require('../utils/telegram');

const INSTAGRAM_API_ENDPOINT = 'https://api.ferdev.my.id/downloader/instagram';
const API_TIMEOUT = 30000;
const MAX_SLIDE_BUTTONS = 5;

// State SEMENTARA untuk deskripsi Instagram
const instagramDescriptions = {};

function buildButtonGrid(flatButtons, columns = 2) {
    const grid = [];
    if (!flatButtons || flatButtons.length === 0) return grid;
    for (let i = 0; i < flatButtons.length; i += columns) {
        grid.push(flatButtons.slice(i, i + columns));
    }
    return grid;
}

function generateSimpleId() {
    return Math.random().toString(36).substring(2, 9);
}

async function handleInstagramLink(extractedLink, chatId) {
    try {
        const apiUrl = `${INSTAGRAM_API_ENDPOINT}?link=${encodeURIComponent(extractedLink)}`;
        console.log(`[Instagram Handler] Calling API for chat ${chatId}: ${apiUrl}`);
        const response = await axios.get(apiUrl, { timeout: API_TIMEOUT });
        console.log(`[Instagram Handler] API Response for chat ${chatId}:`, JSON.stringify(response.data, null, 2));

        const isSuccess = response.data && (response.data.succes || response.data.success);

        if (isSuccess && response.data.data) {
            const data = response.data.data;
            const metadata = data.metadata || {};

            // Ambil deskripsi (title) dan data lain TANPA escape manual
            const description = metadata.title ? he.decode(metadata.title) : ''; // Ini deskripsi lengkapnya
            const usernameText = metadata.username ? metadata.username : '';
            const username = usernameText ? `👤 *Oleh:* @${usernameText}\n` : '';
            const postedAt = metadata.takenAt ? timestampToDate(metadata.takenAt) : 'Tidak diketahui';

            const uniqueMediaId = metadata.shortcode || generateSimpleId();

            // Simpan deskripsi lengkap ke state SEMENTARA jika ada
            if (uniqueMediaId && description) {
                if (!instagramDescriptions[chatId]) {
                    instagramDescriptions[chatId] = {};
                }
                instagramDescriptions[chatId][uniqueMediaId] = description;
                console.log(`[Instagram Handler] Stored description for chat ${chatId}, media ${uniqueMediaId}`);
            }

            // --- BUAT CAPTION UTAMA (Selalu tampilkan deskripsi lengkap jika ada) ---
            const caption = `✨ *Deskripsi:*\n${description}\n\n${username}📅 *DIPOSTING PADA:* ${postedAt}`;
            // --------------------------------------------------------------------

            if (data.type === 'slide' && data.slides && data.slides.length > 0) {
                // --- Handle Slide/Carousel ---
                console.log(`[Instagram Handler] Detected 'slide' type for chat ${chatId}`);
                const mediaGroup = [];
                const flatSlideButtons = [];

                const buttonLimit = Math.min(data.slides.length, MAX_SLIDE_BUTTONS);
                let hasMediaToSend = false;

                for (let i = 0; i < data.slides.length; i++) {
                    if (mediaGroup.length >= 10) break;
                    const slide = data.slides[i];
                    const mediaInfo = slide.mediaUrls?.[0];
                    if (!mediaInfo || !mediaInfo.url) continue;
                    hasMediaToSend = true;
                    const mediaUrl = mediaInfo.url;
                    const mediaType = (mediaInfo.type === 'mp4' || mediaUrl.includes('.mp4')) ? 'video' : 'photo';
                    const mediaObj = { type: mediaType, media: mediaUrl };
                    if (i === 0) {
                        // Gunakan caption utama (sudah lengkap) + nomor slide
                        mediaObj.caption = `${caption}\n\n_(Slide ${i + 1}/${data.slides.length})_`;
                    }
                    mediaGroup.push(mediaObj);
                    if (i < buttonLimit) {
                        flatSlideButtons.push({
                            text: `Slide ${i + 1} ${mediaType === 'video' ? 'Vid' : 'Pic'}`,
                            url: mediaUrl
                        });
                    }
                }

                if (!hasMediaToSend) {
                     await sendMessage(chatId, '❌ Tidak dapat menemukan media yang valid dalam slide ini. 🗿');
                     return;
                }

                if (hasMediaToSend && data.thumbnailUrl) {
                    flatSlideButtons.push({ text: 'Thumbnail Utama 🖼️', url: data.thumbnailUrl });
                }
                 // Tambahkan tombol deskripsi JIKA deskripsi ada
                if (description && uniqueMediaId) {
                    flatSlideButtons.push({
                        text: 'Salin Deskripsi 📝', // Ubah teks tombol?
                        callback_data: `igdesc:${chatId}:${uniqueMediaId}`
                    });
                }

                const inlineKeyboardGrid = buildButtonGrid(flatSlideButtons, 2);
                const replyMarkup = inlineKeyboardGrid.length > 0 ? { inline_keyboard: inlineKeyboardGrid } : null;
                let mediaSent = false; // Ganti nama variabel

                if (mediaGroup.length >= 2) {
                     mediaSent = await sendAlbum(chatId, mediaGroup);
                } else if (mediaGroup.length === 1) {
                     console.warn(`[Instagram Handler] Only 1 valid slide found for chat ${chatId}, sending as single media.`);
                     const item = mediaGroup[0];
                     // Gunakan caption utama (sudah lengkap)
                     mediaSent = await trySendMedia(chatId, item.type, item.media, caption, replyMarkup); // Langsung kirim dengan tombol
                }

                // Kirim tombol & notifikasi HANYA jika dari sendAlbum (karena trySendMedia sudah include tombol)
                if (mediaSent && mediaGroup.length >= 2 && replyMarkup) {
                    await sendMessage(chatId, "Tombol Unduhan & Info:", replyMarkup);
                    if (data.slides.length > MAX_SLIDE_BUTTONS) {
                        await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_BUTTONS} slide pertama yang ditampilkan.)_`);
                    }
                } else if (!mediaSent && replyMarkup) { // Jika pengiriman media gagal
                    await sendMessage(chatId, "⚠️ Gagal mengirim media slide. Coba tombol unduhan ini:", replyMarkup);
                    if (data.slides.length > MAX_SLIDE_BUTTONS) {
                         await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_BUTTONS} slide pertama yang ditampilkan.)_`);
                    }
                } else if (!mediaSent) {
                    await sendMessage(chatId, `❌ Gagal mengirim media slide dan tidak ada tombol unduhan. 🗿`);
                }

            } else {
                // --- Handle Konten Tunggal (Post/Story Video/Foto) ---
                console.log(`[Instagram Handler] Detected single content type (type: ${data.type}) for chat ${chatId}`);
                const mediaInfo = data.videoUrls?.[0];
                const thumbnailUrl = data.thumbnailUrl;

                if (!mediaInfo || !mediaInfo.url) {
                    await sendMessage(chatId, '❌ Maaf, tidak dapat menemukan URL media utama dari postingan/story ini. 🗿');
                    return;
                }

                const mediaUrl = mediaInfo.url;
                const mediaApiType = mediaInfo.type;
                const telegramMediaType = (mediaApiType === 'mp4' || mediaUrl.includes('.mp4')) ? 'video' : 'photo';

                // Gunakan caption utama (sudah lengkap)
                // const caption = `✨ *Deskripsi:*\n${description}\n\n${username}📅 *DIPOSTING PADA:* ${postedAt}`; // Definisikan lagi di sini jika perlu

                const flatSingleButtons = [];
                flatSingleButtons.push({ text: `Unduh ${telegramMediaType === 'video' ? 'Video 🎞️' : 'Foto 📸'}`, url: mediaUrl });
                if (telegramMediaType === 'video' && thumbnailUrl && thumbnailUrl !== mediaUrl) {
                    flatSingleButtons.push({ text: 'Unduh Thumbnail 🖼️', url: thumbnailUrl });
                }
                // Tambahkan tombol deskripsi JIKA deskripsi ada
                if (description && uniqueMediaId) {
                     flatSingleButtons.push({
                         text: 'Salin Deskripsi 📝', // Ubah teks tombol?
                         callback_data: `igdesc:${chatId}:${uniqueMediaId}`
                     });
                 }

                const inlineKeyboardGrid = buildButtonGrid(flatSingleButtons, 2);
                const replyMarkup = inlineKeyboardGrid.length > 0 ? { inline_keyboard: inlineKeyboardGrid } : null;

                let sentSuccessfully = false;

                if (!sentSuccessfully) {
                    // Kirim media utama DENGAN caption lengkap dan tombol
                    sentSuccessfully = await trySendMedia(chatId, telegramMediaType, mediaUrl, caption, replyMarkup);
                }

                // Fallback ke thumbnail (jika video gagal & thumb ada)
                if (!sentSuccessfully && telegramMediaType === 'video' && thumbnailUrl) {
                    // Caption untuk thumbnail bisa dibuat ulang atau pakai caption utama
                    const thumbCaption = `🖼️ Thumbnail untuk post/story:\n\n${caption}`; // Gunakan caption utama di sini
                    const thumbSent = await trySendMedia(chatId, 'photo', thumbnailUrl, thumbCaption, null); // Kirim thumb tanpa tombol
                    if (thumbSent && replyMarkup) {
                        // Jika thumb berhasil, kirim tombol ASLI secara terpisah
                        await sendMessage(chatId, "Tombol Unduhan & Info:", replyMarkup);
                        sentSuccessfully = true;
                    }
                }

                // Fallback terakhir jika semua gagal
                if (!sentSuccessfully) {
                     if (replyMarkup) {
                         await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                     } else {
                         await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
                     }
                }
            }
        } else {
            const errorMessage = response.data.message || 'Gagal mengambil link atau data kosong dari Instagram.';
            await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader Instagram: ${errorMessage} 🗿`);
        }
    } catch (apiError) {
        console.error(`[Instagram Handler] Error calling API for chat ${chatId}:`, apiError.message);
        let errorText = '❌ Maaf, terjadi kesalahan internal saat mencoba mengambil link Instagram. 🗿';
        if (apiError.code === 'ECONNABORTED') {
            errorText = '❌ Maaf, server downloader Instagram terlalu lama merespons. 🗿';
        } else if (apiError.response && apiError.response.data && apiError.response.data.message) {
            errorText = `❌ Maaf, terjadi kesalahan saat menghubungi server downloader Instagram: ${apiError.response.data.message} 🗿`;
        }
        await sendMessage(chatId, errorText);
    }
}

// Fungsi get/clear deskripsi tetap sama
function getStoredInstagramDescription(chatId, mediaId) {
    return instagramDescriptions[chatId]?.[mediaId];
}
function clearStoredInstagramDescription(chatId, mediaId) {
     if (instagramDescriptions[chatId]?.[mediaId]) {
        delete instagramDescriptions[chatId][mediaId];
        console.log(`[Instagram Handler] Cleared stored description for chat ${chatId}, media ${mediaId}`);
        if (Object.keys(instagramDescriptions[chatId]).length === 0) {
             delete instagramDescriptions[chatId];
        }
    }
}


module.exports = {
    handleInstagramLink,
    getStoredInstagramDescription,
    clearStoredInstagramDescription
};