// lib/handlers/tiktok.js
const axios = require('axios');
const he = require('he');
const { sendMessage, trySendMedia, sendAlbum } = require('../utils/telegram');

// API Endpoints
const TIKTOK_API_1_ENDPOINT = 'https://api.ferdev.my.id/downloader/tiktok';
const TIKTOK_API_2_ENDPOINT = 'https://api.vreden.my.id/api/tiktok';

// Timeouts
const API_1_TIMEOUT = 25000;
const API_2_TIMEOUT = 15000;

const MAX_SLIDE_IMAGE_BUTTONS = 5;

function generateSimpleId() {
    return Math.random().toString(36).substring(2, 9);
}

const tiktokDescriptions = {}; // State sementara

async function handleTikTokLink(extractedLink, chatId, userState) { // Terima userState jika diperlukan
    try {
        const apiUrl1 = `${TIKTOK_API_1_ENDPOINT}?link=${encodeURIComponent(extractedLink)}`;
        const apiUrl2 = `${TIKTOK_API_2_ENDPOINT}?url=${encodeURIComponent(extractedLink)}`;

        console.log(`[TikTok Handler] Calling API 1 (Media): ${apiUrl1}`);
        console.log(`[TikTok Handler] Calling API 2 (Title): ${apiUrl2}`);

        const [resultApi1, resultApi2] = await Promise.allSettled([
            axios.get(apiUrl1, { timeout: API_1_TIMEOUT }),
            axios.get(apiUrl2, { timeout: API_2_TIMEOUT })
        ]);

        let mediaData = null;
        let isApi1Success = false;
        let descriptionFromApi1 = '';
        let uniqueMediaId = null;

        if (resultApi1.status === 'fulfilled' && resultApi1.value.data) {
            const responseApi1 = resultApi1.value.data;
            console.log(`[TikTok Handler] API 1 Response:`, JSON.stringify(responseApi1, null, 2));
            isApi1Success = responseApi1 && (responseApi1.succes || responseApi1.success);
            if (isApi1Success && responseApi1.data) {
                mediaData = responseApi1.data;
                if (mediaData.description) {
                    descriptionFromApi1 = he.decode(mediaData.description);
                }
                uniqueMediaId = mediaData.uniqueId || generateSimpleId();
            } else {
                console.error(`[TikTok Handler] API 1 returned success=false or no data. Message: ${responseApi1.message}`);
            }
        } else {
            console.error(`[TikTok Handler] API 1 (Media) failed:`, resultApi1.reason?.message || resultApi1.reason || 'Unknown error');
        }

        let titleFromApi2 = '';
        if (resultApi2.status === 'fulfilled' && resultApi2.value.data) {
            const responseApi2 = resultApi2.value.data;
            console.log(`[TikTok Handler] API 2 Response:`, JSON.stringify(responseApi2, null, 2));
            if (responseApi2.status === 200 && responseApi2.result?.title) {
                titleFromApi2 = he.decode(responseApi2.result.title);
                console.log(`[TikTok Handler] Title successfully retrieved from API 2: "${titleFromApi2}"`);
            } else {
                console.warn(`[TikTok Handler] API 2 (Title) did not return a valid title. Status: ${responseApi2.status}`);
            }
        } else {
             console.error(`[TikTok Handler] API 2 (Title) failed:`, resultApi2.reason?.message || resultApi2.reason || 'Unknown error');
             if (!isApi1Success) {
                 await sendMessage(chatId, `❌ Maaf, gagal menghubungi server downloader TikTok. Coba lagi nanti. 🗿`);
                 return;
             }
        }

        if (!isApi1Success || !mediaData) {
            const errorMessage = resultApi1.status === 'fulfilled' ? (resultApi1.value.data?.message || 'Data media tidak valid') : (resultApi1.reason?.message || 'Gagal mengambil data media');
            await sendMessage(chatId, `❌ Maaf, gagal mengambil data media TikTok: ${errorMessage} 🗿`);
            return;
        }

        const finalDescription = titleFromApi2 || descriptionFromApi1 || '';
        const dlink = mediaData.dlink || {}; // Ambil dlink dari API 1

        // Simpan deskripsi ke state SEMENTARA jika ada ID
        if (uniqueMediaId && finalDescription) {
            if (!tiktokDescriptions[chatId]) {
                tiktokDescriptions[chatId] = {};
            }
            tiktokDescriptions[chatId][uniqueMediaId] = finalDescription;
             console.log(`[TikTok Handler] Stored description for chat ${chatId}, media ${uniqueMediaId}`);
        }


        // --- Cek Tipe Konten (dari API 1) ---
        if (mediaData.type === 'slide' && mediaData.slides && mediaData.slides.length > 0) {
            // --- Handle TikTok Slide ---
            console.log(`[TikTok Handler] Detected 'slide' type for chat ${chatId}`);
            const mediaGroup = [];
            const downloadButtons = []; // Array of arrays untuk tombol vertikal
            const slideImageUrls = mediaData.slides;
            const captionPrefix = finalDescription ? `📸 *Deskripsi Slide:* ${finalDescription}` : '📸 Slide TikTok';


            const buttonLimit = Math.min(slideImageUrls.length, MAX_SLIDE_IMAGE_BUTTONS);
            let hasMediaToSend = false;

            for (let i = 0; i < slideImageUrls.length; i++) {
                 if (mediaGroup.length >= 10) break;
                 const imageUrl = slideImageUrls[i];
                 if (!imageUrl) continue;
                 hasMediaToSend = true;
                 const mediaObj = { type: 'photo', media: imageUrl };
                 if (i === 0) {
                    mediaObj.caption = `${captionPrefix}\n\n_(Gambar ${i + 1}/${slideImageUrls.length})_`;
                 }
                 mediaGroup.push(mediaObj);
                 if (i < buttonLimit) {
                    downloadButtons.push([{ text: `Unduh Gbr Slide ${i + 1}`, url: imageUrl }]);
                 }
            }

            if (!hasMediaToSend) {
                 await sendMessage(chatId, '❌ Tidak dapat menemukan gambar yang valid dalam slide TikTok ini. 🗿');
                 return;
            }

            // Tombol Tambahan KHUSUS SLIDE (Audio, Profil - TANPA Cover)
            const audioUrl = dlink.audio || mediaData.ttdlAudio;
            if (audioUrl) downloadButtons.push([{ text: 'Unduh Audio Latar 🎵', url: audioUrl }]);
            // JANGAN tampilkan tombol cover untuk slide
            // if (dlink.cover) downloadButtons.push([{ text: 'Unduh Cover 🖼️', url: dlink.cover }]);
            if (dlink.profilePic) downloadButtons.push([{ text: 'Unduh Foto Profil 👤', url: dlink.profilePic }]);
            // Tombol Deskripsi
             if (finalDescription && uniqueMediaId) {
                 downloadButtons.push([{
                     text: 'Deskripsi Lengkap 📝',
                     callback_data: `ttdesc:${chatId}:${uniqueMediaId}`
                 }]);
            }

            const replyMarkup = downloadButtons.length > 0 ? { inline_keyboard: downloadButtons } : null;
            let mediaSent = false; // Ganti nama variabel agar lebih jelas

            // ---- PERBAIKAN LOGIKA PENGIRIMAN SLIDE ----
            if (mediaGroup.length >= 2) {
                mediaSent = await sendAlbum(chatId, mediaGroup);
                // Jika album terkirim DAN ada tombol, kirim tombol sebagai pesan baru
                if (mediaSent && replyMarkup) {
                    await sendMessage(chatId, "Tombol Unduhan & Info:", replyMarkup);
                    if (slideImageUrls.length > MAX_SLIDE_IMAGE_BUTTONS) {
                        await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_IMAGE_BUTTONS} gambar slide pertama yang ditampilkan.)_`);
                    }
                }
                // JANGAN lakukan apa-apa lagi jika album terkirim, KECUALI jika gagal
            } else if (mediaGroup.length === 1) {
                console.warn(`[TikTok Handler] Only 1 valid slide image found for chat ${chatId}, sending as single photo.`);
                // Kirim sebagai foto tunggal, SUDAH TERMASUK TOMBOL (replyMarkup)
                mediaSent = await trySendMedia(chatId, 'photo', mediaGroup[0].media, mediaGroup[0].caption || captionPrefix, replyMarkup);
                // TIDAK PERLU kirim tombol lagi jika trySendMedia berhasil
            }

            // Handle kegagalan SETELAH mencoba mengirim (baik album maupun single)
            if (!mediaSent) {
                 if (replyMarkup) {
                     // Jika pengiriman media gagal tapi tombol ada, tawarkan tombol
                     await sendMessage(chatId, "⚠️ Gagal mengirim media slide. Coba tombol unduhan ini:", replyMarkup);
                     if (slideImageUrls.length > MAX_SLIDE_IMAGE_BUTTONS) {
                         await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_IMAGE_BUTTONS} gambar slide pertama yang ditampilkan.)_`);
                     }
                 } else {
                     // Jika gagal DAN tidak ada tombol
                     await sendMessage(chatId, `❌ Gagal mengirim media slide dan tidak ada tombol unduhan. 🗿`);
                 }
            }
            // ---- AKHIR PERBAIKAN LOGIKA PENGIRIMAN SLIDE ----


        } else if (mediaData.type === 'video') {
            // --- Handle TikTok Video Tunggal ---
            console.log(`[TikTok Handler] Detected 'video' type for chat ${chatId}`);
            const videoUrl = dlink.nowm;
            const coverUrl = dlink.cover; // Cover relevan untuk video
            const profileUrl = dlink.profilePic;
            const audioUrl = dlink.audio || mediaData.ttdlAudio;

            if (!videoUrl && !coverUrl) {
                await sendMessage(chatId, '❌ Maaf, API TikTok tidak menemukan link video atau cover. 🗿');
                return;
            }

            const caption = finalDescription ? `🎶 *Deskripsi:* ${finalDescription}` : '🎶 Video TikTok';

            const buttons = [];
            if (videoUrl) buttons.push([{ text: 'Unduh Video (Tanpa WM) 💃', url: videoUrl }]);
            if (coverUrl) buttons.push([{ text: 'Unduh Cover 🖼️', url: coverUrl }]); // Tombol cover OK untuk video
            if (profileUrl) buttons.push([{ text: 'Unduh Foto Profil 👤', url: profileUrl }]);
            if (audioUrl) buttons.push([{ text: 'Unduh Audio 🎵', url: audioUrl }]);
            if (finalDescription && uniqueMediaId) {
                buttons.push([{
                    text: 'Deskripsi Lengkap 📝',
                    callback_data: `ttdesc:${chatId}:${uniqueMediaId}`
                }]);
            }
            const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

            let sentSuccessfully = false;

            if (!sentSuccessfully && videoUrl) {
                sentSuccessfully = await trySendMedia(chatId, 'video', videoUrl, caption, replyMarkup);
            }
            // Fallback ke cover HANYA jika video GAGAL DIKIRIM
            if (!sentSuccessfully && coverUrl) {
                 const coverCaption = `🖼️ Cover untuk:\n${caption}`;
                 // Kirim cover sebagai foto, sertakan tombol asli (replyMarkup)
                 sentSuccessfully = await trySendMedia(chatId, 'photo', coverUrl, coverCaption, replyMarkup);
            }

            if (!sentSuccessfully) {
                 if (replyMarkup) {
                     await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
                 } else {
                     await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
                 }
            }
        } else {
             console.warn(`[TikTok Handler] Unknown data type from API 1: ${mediaData.type} for chat ${chatId}`);
             await sendMessage(chatId, `❌ Tipe konten TikTok tidak dikenal (${mediaData.type}). 🗿`);
        }

    } catch (error) {
        console.error(`[TikTok Handler] Unexpected error for chat ${chatId}:`, error);
        await sendMessage(chatId, '❌ Maaf, terjadi kesalahan tidak terduga saat memproses link TikTok. 🗿');
    }
}

// ... (fungsi get/clear deskripsi tetap sama) ...
function getStoredTikTokDescription(chatId, mediaId) {
    return tiktokDescriptions[chatId]?.[mediaId];
}
function clearStoredTikTokDescription(chatId, mediaId) {
     if (tiktokDescriptions[chatId]?.[mediaId]) {
        delete tiktokDescriptions[chatId][mediaId];
        console.log(`[TikTok Handler] Cleared stored description for chat ${chatId}, media ${mediaId}`);
        if (Object.keys(tiktokDescriptions[chatId]).length === 0) {
             delete tiktokDescriptions[chatId];
        }
    }
}

module.exports = {
    handleTikTokLink,
    getStoredTikTokDescription,
    clearStoredTikTokDescription
};