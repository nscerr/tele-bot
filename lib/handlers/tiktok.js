// lib/handlers/tiktok.js
const axios = require('axios');
const he = require('he');
const FormData = require('form-data');
const path =require('path');
const { sendMessage, trySendMedia, sendAlbum } = require('../utils/telegram');
// MODIFIKASI: Impor logger
const logger = require('../utils/logger'); // Pastikan path ini benar

const TIKTOK_API_1_ENDPOINT = 'https://vapis.my.id/api/ttdl?url=';
const TIKTOK_API_2_ENDPOINT = 'https://api.vreden.my.id/api/tiktok';

const API_1_TIMEOUT = 25000;
const API_2_TIMEOUT = 20000;

const UGUU_UPLOAD_ENDPOINT = 'https://uguu.se/upload';
const UGUU_UPLOAD_TIMEOUT = 90000;
const MAX_FILE_SIZE_FOR_UGUU = 128 * 1024 * 1024;

const MAX_SLIDE_IMAGE_BUTTONS = 5;
const tiktokDescriptions = {};
let nextApiToUse = 1;

// --- Fungsi Utilitas ---
function generateSimpleId() {
    return Math.random().toString(36).substring(2, 9);
}

function getFileExtensionFromUrl(url) {
    if (!url) return '.tmp';
    try {
        const pathname = new URL(url).pathname;
        const ext = path.extname(pathname);
        if (!ext && url.includes('photomode')) return '.jpg';
        if (!ext && (url.includes('video') || url.includes('mp4'))) return '.mp4';
        return ext || '.tmp';
    } catch (e) {
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn({ url, errName: e.name, errMsg: e.message, context: 'getFileExtensionFromUrl' }, `Error parsing URL ${url}`);
        return '.tmp';
    }
}

async function uploadToUguu(mediaUrl, desiredFilename) {
    const logContext = { mediaUrl, desiredFilename, uploadEndpoint: UGUU_UPLOAD_ENDPOINT, context: 'uploadToUguu' };
    if (!mediaUrl) {
        // MODIFIKASI: console.error -> logger.error
        logger.error(logContext, 'mediaUrl tidak disediakan.');
        return null;
    }
    let filename = desiredFilename || `media_${generateSimpleId()}${getFileExtensionFromUrl(mediaUrl)}`;
    filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 100);
    logContext.finalFilename = filename;

    try {
        // MODIFIKASI: console.log -> logger.info
        logger.info(logContext, `Mengunduh dari mediaUrl untuk diunggah sebagai ${filename}`);
        const response = await axios({ method: 'get', url: mediaUrl, responseType: 'stream', timeout: 45000 });

        const form = new FormData();
        form.append('files[]', response.data, filename);

        // MODIFIKASI: console.log -> logger.info
        logger.info(logContext, `Mengunggah ${filename} ke UGUU_UPLOAD_ENDPOINT...`);
        const uploadResponse = await axios.post(UGUU_UPLOAD_ENDPOINT, form, { headers: { ...form.getHeaders() }, timeout: UGUU_UPLOAD_TIMEOUT });

        if (uploadResponse.status === 200 && uploadResponse.data?.success === true && uploadResponse.data.files?.length > 0) {
            const uploadedFile = uploadResponse.data.files[0];
            // MODIFIKASI: console.log -> logger.info
            logger.info({ ...logContext, uploadedUrl: uploadedFile.url, uploadedFilename: uploadedFile.filename, size: uploadedFile.size }, 
                        `Berhasil diunggah: ${uploadedFile.url}`);
            return uploadedFile.url;
        }
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...logContext, responseStatus: uploadResponse.status, responseData: uploadResponse.data },
                     'Gagal unggah atau respons Uguu tidak sesuai.');
        return null;
    } catch (error) {
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...logContext, err: error, responseData: error.response?.data },
                     `Error selama proses unggah Uguu untuk ${mediaUrl}`);
        return null;
    }
}

async function getFinalMediaUrl(originalUrl, originalSize, filenameHint, functionContextStr) {
    const logContext = { originalUrl, originalSize, filenameHint, functionContextStr, context: 'getFinalMediaUrl' };
    logger.debug(logContext, "Memulai getFinalMediaUrl");

    if (!originalUrl) {
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn(logContext, 'URL asli tidak tersedia, mengembalikan URL asli (null/undefined).');
        return originalUrl;
    }
    if (originalSize && originalSize > MAX_FILE_SIZE_FOR_UGUU) {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, maxSizeForUguu: MAX_FILE_SIZE_FOR_UGUU, decision: 'useOriginalUrl' }, 
                    `File terlalu besar (${(originalSize / (1024*1024)).toFixed(2)}MB), pakai URL asli.`);
        return originalUrl;
    }
    if (originalSize === 0 && originalUrl.includes('mp4')) {
         // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, decision: 'attemptUploadDespiteZeroSize' }, 
                    'Ukuran 0 untuk MP4, tetap coba unggah ke Uguu.');
    }

    const baseName = filenameHint ? filenameHint.substring(0, 50).replace(/[^a-zA-Z0-9_.-]/g, '_') : "tiktok_media";
    const descriptiveFilename = `${baseName}_${generateSimpleId()}${getFileExtensionFromUrl(originalUrl)}`;
    logContext.descriptiveFilename = descriptiveFilename;

    // MODIFIKASI: console.log -> logger.info
    logger.info(logContext, `Mencoba unggah ${originalUrl} ke uguu.se sebagai ${descriptiveFilename}.`);

    const uguuUrl = await uploadToUguu(originalUrl, descriptiveFilename);

    if (uguuUrl) {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, uguuUrl, decision: 'useUguuUrl' }, `Sukses unggah ke uguu.se: ${uguuUrl}`);
        return uguuUrl;
    }
    // MODIFIKASI: console.warn -> logger.warn
    logger.warn({ ...logContext, decision: 'useOriginalUrlAfterFail' }, 
                `Gagal unggah ${originalUrl} ke uguu.se. Pakai URL asli.`);
    return originalUrl;
}

// --- Fungsi Utama Handler TikTok ---
async function handleTikTokLink(extractedLink, chatId, userState) {
    // MODIFIKASI: Tambah log masuk ke fungsi
    const logContext = { extractedLink, chatId, userStateProvided: !!userState, context: 'handleTikTokLink_entry' };
    logger.info(logContext, 'Memulai penanganan link TikTok.');

    let initialApiToTry = nextApiToUse;
    let successfullyProcessed = false;
    let attempt = 1;
    const maxAttempts = 2;

    // MODIFIKASI: console.log -> logger.debug
    logger.debug({ ...logContext, initialApiToTry }, `Initial API: API ${initialApiToTry}`);
    let currentApiToProcess = initialApiToTry;

    while (attempt <= maxAttempts && !successfullyProcessed) {
        const attemptLogContext = { ...logContext, attempt, currentApiToProcess, handlerAttempt: attempt };
        // MODIFIKASI: console.log -> logger.info
        logger.info(attemptLogContext, `Attempt ${attempt}: Processing with API ${currentApiToProcess}`);
        try {
            if (currentApiToProcess === 1) {
                successfullyProcessed = await processWithApi1(extractedLink, chatId);
            } else if (currentApiToProcess === 2) {
                successfullyProcessed = await processWithApi2(extractedLink, chatId);
            }

            if (successfullyProcessed) {
                // MODIFIKASI: console.log -> logger.info
                logger.info(attemptLogContext, `Successfully processed with API ${currentApiToProcess}`);
                nextApiToUse = (currentApiToProcess % 2) + 1; // Switch to the other API for next time
                return; // Keluar dari loop dan fungsi
            }
            // MODIFIKASI: console.warn -> logger.warn
            logger.warn(attemptLogContext, `API ${currentApiToProcess} failed. Trying next.`);
            currentApiToProcess = (currentApiToProcess % 2) + 1;
        } catch (error) {
            // MODIFIKASI: console.error -> logger.error
            logger.error({ ...attemptLogContext, err: error }, `Critical error within handleTikTokLink with API ${currentApiToProcess}`);
            currentApiToProcess = (currentApiToProcess % 2) + 1; // Tetap coba API berikutnya meskipun ada error kritis di loop
        }
        attempt++;
    }

    if (!successfullyProcessed) {
        // MODIFIKASI: console.error -> logger.error
        logger.error(logContext, 'Semua API TikTok gagal memproses link.');
        await sendMessage(chatId, '❌ Maaf, semua server downloader TikTok sedang sibuk atau gagal memproses link Anda. Coba lagi nanti. 🗿');
    }
}

// --- Fungsi Generik untuk Memproses dan Mengirim Media ---
async function processAndSendMedia(chatId, extractedMediaData) {
    const { uniqueMediaId, apiSourceName } = extractedMediaData;
    const logContext = { chatId, uniqueMediaId, apiSourceName, context: 'processAndSendMedia_entry' };
    logger.info(logContext, 'Memulai pemrosesan dan pengiriman media.');
    logger.debug({ ...logContext, extractedMediaDataDetails: extractedMediaData });

    const {
        description, authorUsername, takenAt,
        filenameHintBase, originalCoverUrl, originalCoverSize,
        originalAudioUrl, originalAudioSize, originalProfilePicUrl,
        videoHd: originalVideoHd, videoSd: originalVideoSd, slidePhotos
    } = extractedMediaData;

    let baseCaptionText = description ? `📝 *Deskripsi:* ${he.decode(description)}` : 'ℹ️ Konten TikTok';
    if (authorUsername) baseCaptionText += `\n\nDiposting oleh: @${authorUsername}`;
    const takenAtDisplay = takenAt || "Tidak Diketahui";
    baseCaptionText += `\nDiposting pada: ${takenAtDisplay}`;
    const captionSuffix = `\n\n*(via ${apiSourceName})*`;
    const finalCaption = baseCaptionText + captionSuffix;

    let slideBaseCaptionPrefix = description ? `📸 *Slide:* ${he.decode(description)}` : '📸 Slide TikTok';
    if (authorUsername) slideBaseCaptionPrefix += `\n\nDiposting oleh: @${authorUsername}`;
    slideBaseCaptionPrefix += `\nDiposting pada: ${takenAtDisplay}`;

    // MODIFIKASI: console.log -> logger.debug (info lebih detail sudah di log masuk)
    logger.debug(logContext, `Processing details for ${uniqueMediaId}`);

    const contextPrefix = `MediaProcessor (${apiSourceName})`;
    const finalCoverUrl = await getFinalMediaUrl(originalCoverUrl, originalCoverSize, `${filenameHintBase}_cover`, `${contextPrefix} Cover`);
    const finalAudioUrl = await getFinalMediaUrl(originalAudioUrl, originalAudioSize, `${filenameHintBase}_audio`, `${contextPrefix} Audio`);
    const finalProfilePicUrl = await getFinalMediaUrl(originalProfilePicUrl, null, `${filenameHintBase}_profile`, `${contextPrefix} Profile`);
    const finalVideoHdUrl = await getFinalMediaUrl(originalVideoHd?.url, originalVideoHd?.size, `${filenameHintBase}_videoHD`, `${contextPrefix} VideoHD`);
    const finalVideoSdUrl = await getFinalMediaUrl(originalVideoSd?.url, originalVideoSd?.size, `${filenameHintBase}_videoSD`, `${contextPrefix} VideoSD`);

    const finalSlidePhotos = [];
    if (slidePhotos && slidePhotos.length > 0) {
        for (let i = 0; i < slidePhotos.length; i++) {
            const photo = slidePhotos[i];
            const finalUrl = await getFinalMediaUrl(photo.url, photo.size, `${filenameHintBase}_slide${i+1}`, `${contextPrefix} Slide${i+1}`);
            if (finalUrl) finalSlidePhotos.push({ url: finalUrl });
        }
    }

    let isVideo = !!(finalVideoHdUrl || finalVideoSdUrl);
    let isSlide = finalSlidePhotos.length > 0;
    let sentSuccessfully = false;
    const buttons = [];

    if (isVideo) {
        if (finalVideoHdUrl) buttons.push([{ text: `Unduh Video HD 💃`, url: finalVideoHdUrl }]);
        if (finalVideoSdUrl && (finalVideoSdUrl !== finalVideoHdUrl || !finalVideoHdUrl)) {
            buttons.push([{ text: 'Unduh Video SD 🎞️', url: finalVideoSdUrl }]);
        }
    }
    if (isSlide && finalSlidePhotos.length > 0 && !isVideo) {
        const slideButtonLimit = Math.min(finalSlidePhotos.length, MAX_SLIDE_IMAGE_BUTTONS);
        for (let i = 0; i < slideButtonLimit; i++) {
            buttons.push([{ text: `Unduh Gbr Slide ${i+1}`, url: finalSlidePhotos[i].url }]);
        }
    }
    if (finalCoverUrl && !isSlide) buttons.push([{ text: 'Unduh Cover 🖼️', url: finalCoverUrl }]);
    if (finalAudioUrl) buttons.push([{ text: 'Unduh Audio Asli 🎵', url: finalAudioUrl }]);
    if (finalProfilePicUrl) buttons.push([{ text: 'Foto Profil 👤', url: finalProfilePicUrl }]);
    if (description) buttons.push([{ text: 'Deskripsi Lengkap 📝', callback_data: `ttdesc:${chatId}:${uniqueMediaId}` }]);

    const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

    if (isVideo) {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, mediaType: 'video', primaryUrl: finalVideoHdUrl || finalVideoSdUrl }, 'Mencoba mengirim VIDEO.');
        const primaryVideoUrlToSend = finalVideoHdUrl || finalVideoSdUrl;
        sentSuccessfully = await trySendMedia(chatId, 'video', primaryVideoUrlToSend, finalCaption, replyMarkup, "Markdown");
        if (!sentSuccessfully && finalVideoSdUrl && finalVideoSdUrl !== primaryVideoUrlToSend) {
            logger.warn({ ...logContext, mediaType: 'video', attemptUrl: finalVideoSdUrl }, 'Pengiriman video utama gagal, mencoba SD.');
            sentSuccessfully = await trySendMedia(chatId, 'video', finalVideoSdUrl, finalCaption, replyMarkup, "Markdown");
        }
        if (!sentSuccessfully && finalCoverUrl) {
            // MODIFIKASI: console.log -> logger.warn
            logger.warn({ ...logContext, fallbackTo: 'cover' }, 'Video gagal, coba kirim cover.');
            const coverCaption = `🖼️ *Cover (Video Gagal):*\n${baseCaptionText}${captionSuffix}`;
            sentSuccessfully = await trySendMedia(chatId, 'photo', finalCoverUrl, coverCaption, replyMarkup, "Markdown");
        }
    } else if (isSlide) {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, mediaType: 'slide', photoCount: finalSlidePhotos.length }, `Mencoba mengirim SLIDE dengan ${finalSlidePhotos.length} foto.`);
        const mediaGroup = [];
        const downloadButtonsForSlideAlbum = [];

        for (let i = 0; i < finalSlidePhotos.length; i++) {
            if (mediaGroup.length < 10) {
                const mediaObj = { type: 'photo', media: finalSlidePhotos[i].url };
                if (mediaGroup.length === 0) {
                    mediaObj.caption = `${slideBaseCaptionPrefix}\n\n_(Gambar ${mediaGroup.length + 1} dari ${finalSlidePhotos.length})_${captionSuffix}`;
                    mediaObj.parse_mode = "Markdown";
                }
                mediaGroup.push(mediaObj);
            }
            if (downloadButtonsForSlideAlbum.filter(btnRow => btnRow.length > 0).length < MAX_SLIDE_IMAGE_BUTTONS) {
                downloadButtonsForSlideAlbum.push([{ text: `Unduh Gbr Slide ${i+1}`, url: finalSlidePhotos[i].url }]);
            }
        }
        if (finalAudioUrl) downloadButtonsForSlideAlbum.push([{ text: 'Unduh Audio Latar 🎵', url: finalAudioUrl }]);
        if (finalProfilePicUrl) downloadButtonsForSlideAlbum.push([{ text: 'Foto Profil 👤', url: finalProfilePicUrl }]);
        if (description) downloadButtonsForSlideAlbum.push([{ text: 'Deskripsi Lengkap 📝', callback_data: `ttdesc:${chatId}:${uniqueMediaId}` }]);
        const slideAlbumReplyMarkup = downloadButtonsForSlideAlbum.length > 0 ? { inline_keyboard: downloadButtonsForSlideAlbum } : null;

        if (mediaGroup.length >= 2) {
            sentSuccessfully = await sendAlbum(chatId, mediaGroup);
            if (sentSuccessfully && slideAlbumReplyMarkup) {
                await sendMessage(chatId, "Tombol Unduhan & Info Tambahan:", slideAlbumReplyMarkup);
                 if (slidePhotos.length > MAX_SLIDE_IMAGE_BUTTONS && finalSlidePhotos.length > MAX_SLIDE_IMAGE_BUTTONS) {
                       await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_IMAGE_BUTTONS} gambar slide pertama ditampilkan.)_`);
                 } else if (slidePhotos.length > finalSlidePhotos.length) {
                        await sendMessage(chatId, `_(Info: Beberapa gambar slide mungkin gagal diproses.)_`);
                 }
            }
        } else if (mediaGroup.length === 1) {
            const singleSlideCaption = `${slideBaseCaptionPrefix}\n\n_(1 gambar berhasil diproses)_${captionSuffix}`;
            sentSuccessfully = await trySendMedia(chatId, 'photo', mediaGroup[0].media, singleSlideCaption, slideAlbumReplyMarkup || replyMarkup, "Markdown");
        }
    } else if (finalCoverUrl) {
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, mediaType: 'coverAsMain' }, 'Bukan video/slide, mengirim COVER sebagai foto utama.');
        sentSuccessfully = await trySendMedia(chatId, 'photo', finalCoverUrl, finalCaption, replyMarkup, "Markdown");
    }

    if (!sentSuccessfully && replyMarkup && (finalVideoHdUrl || finalVideoSdUrl || finalCoverUrl || finalSlidePhotos.length > 0)) {
        logger.warn({ ...logContext, action: 'sentButtonsAsFallback' }, 'Gagal mengirim media, mengirim tombol sebagai fallback.');
        await sendMessage(chatId, `⚠️ Gagal mengirim media secara langsung.\n\n${finalCaption}\n\nCoba unduh via tombol:`, replyMarkup, "Markdown");
        return true;
    }
    if (!sentSuccessfully && !finalVideoHdUrl && !finalVideoSdUrl && !finalCoverUrl && finalSlidePhotos.length === 0) {
        // MODIFIKASI: console.warn -> logger.warn
        logger.warn(logContext, 'Tidak ada media valid yang bisa dikirim atau ditampilkan via tombol.');
        return false;
    }
    return sentSuccessfully;
}

// --- Modifikasi processWithApi ---
async function processWithApi(extractedLink, chatId, apiName, apiUrlBase, apiTimeout, fnExtractData) {
    const logContext = { extractedLink, chatId, apiName, context: `processWithApi_${apiName}_entry` };
    logger.info(logContext, `Mencoba memproses dengan ${apiName}.`);

    const apiUrl = `${apiUrlBase}${encodeURIComponent(extractedLink)}`;
    // MODIFIKASI: console.log -> logger.debug
    logger.debug({ ...logContext, apiUrlRequest: apiUrl }, `Calling ${apiName}: ${apiUrl}`);

    try {
        const response = await axios.get(apiUrl, { timeout: apiTimeout });
        return await fnExtractData(response.data, chatId, apiName, extractedLink); // fnExtractData akan handle logging spesifik parsing
    } catch (error) {
        // MODIFIKASI: console.error -> logger.error
        const errorDetails = { ...logContext, err: error, apiUrlRequest: apiUrl, responseData: error.response?.data };
        if (error.code === 'ECONNABORTED') {
            logger.error(errorDetails, `${apiName} request timed out.`);
        } else {
            logger.error(errorDetails, `Error saat memanggil ${apiName}.`);
        }
        return false;
    }
}

async function extractDataFromApi1(responseData, chatId, apiName, extractedLink) {
    const logContext = { chatId, apiName, extractedLink, context: 'extractDataFromApi1' };
    if (!(responseData?.status === true && responseData.data?.status === true)) {
        const errorMessage = responseData?.data?.msg || responseData?.message || 'Invalid data or API error from API 1';
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...logContext, errorMessage, responseDataRaw: responseData }, 'API 1 gagal atau mengembalikan data tidak valid.');
        return false;
    }
    const apiData = responseData.data;
    logger.debug({ ...logContext, apiDataReceived: apiData }, "Data diterima dari API 1");

    const authorUsername = apiData.author?.fullname || apiData.author?.nickname;
    const description = apiData.title || '';
    const uniqueMediaId = apiData.id ? `${apiData.id}_api1_generic` : (authorUsername ? `${authorUsername}_api1_generic_${Date.now().toString(36)}` : generateSimpleId());

    if (uniqueMediaId && description) {
        if (!tiktokDescriptions[chatId]) tiktokDescriptions[chatId] = {};
        tiktokDescriptions[chatId][uniqueMediaId] = description;
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, uniqueMediaIdForDescription: uniqueMediaId }, 'Deskripsi disimpan dari API 1.');
    }

    const standardizedData = {
        description, authorUsername,
        takenAt: apiData.taken_at || null,
        uniqueMediaId, apiSourceName: "Vapis",
        filenameHintBase: `${authorUsername || 'tiktok'}_${(description || 'media').substring(0,20).replace(/\s+/g, '_')}`,
        originalCoverUrl: apiData.cover || null,
        originalCoverSize: apiData.cover_size || null,
        originalAudioUrl: apiData.music_info?.url || null,
        originalAudioSize: apiData.music_info?.size_nowm || apiData.music_info?.size || null,
        originalProfilePicUrl: apiData.author?.avatar || null,
        videoHd: {
            url: apiData.data?.find(item => item.type === 'nowatermark_hd')?.url || null,
            size: apiData.size_nowm_hd || apiData.data?.find(item => item.type === 'nowatermark_hd')?.size || null
        },
        videoSd: {
            url: apiData.data?.find(item => item.type === 'nowatermark')?.url || null,
            size: apiData.size_nowm || apiData.data?.find(item => item.type === 'nowatermark')?.size || null
        },
        slidePhotos: apiData.data?.filter(item => item.type === 'photo').map(p => ({ url: p.url, size: p.size || null })) || []
    };
    return await processAndSendMedia(chatId, standardizedData);
}

async function extractDataFromApi2(responseData, chatId, apiName, extractedLink) {
    const logContext = { chatId, apiName, extractedLink, context: 'extractDataFromApi2' };
    if (!(responseData?.status === 200 && responseData.result?.status === true)) {
        const errorMessage = responseData?.result?.msg || responseData?.message || 'Invalid data or API error from API 2';
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...logContext, errorMessage, responseDataRaw: responseData }, 'API 2 gagal atau mengembalikan data tidak valid.');
        return false;
    }
    const resultData = responseData.result;
    logger.debug({ ...logContext, apiDataReceived: resultData }, "Data diterima dari API 2");

    const authorUsername = resultData.author?.fullname || resultData.author?.nickname;
    const description = resultData.title || '';
    const uniqueMediaId = resultData.id ? `${resultData.id}_api2_generic` : (authorUsername ? `${authorUsername}_api2_generic_${Date.now().toString(36)}` : generateSimpleId());

    if (uniqueMediaId && description) {
        if (!tiktokDescriptions[chatId]) tiktokDescriptions[chatId] = {};
        tiktokDescriptions[chatId][uniqueMediaId] = description;
        // MODIFIKASI: console.log -> logger.info
        logger.info({ ...logContext, uniqueMediaIdForDescription: uniqueMediaId }, 'Deskripsi disimpan dari API 2.');
    }

    const standardizedData = {
        description, authorUsername,
        takenAt: resultData.taken_at || null,
        uniqueMediaId, apiSourceName: "Vreden",
        filenameHintBase: `${authorUsername || 'tiktok'}_${(description || 'media').substring(0,20).replace(/\s+/g, '_')}`,
        originalCoverUrl: resultData.cover || null,
        originalCoverSize: resultData.cover_size || null,
        originalAudioUrl: resultData.music_info?.url || null,
        originalAudioSize: resultData.music_info?.size || null,
        originalProfilePicUrl: resultData.author?.avatar || null,
        videoHd: {
            url: resultData.data?.find(item => item.type === 'nowatermark_hd')?.url || null,
            size: resultData.data?.find(item => item.type === 'nowatermark_hd')?.size || null
        },
        videoSd: {
            url: resultData.data?.find(item => item.type === 'nowatermark')?.url || null,
            size: resultData.data?.find(item => item.type === 'nowatermark')?.size || null
        },
        slidePhotos: resultData.data?.filter(item => item.type === 'photo').map(p => ({ url: p.url, size: p.size || null })) || []
    };
    return await processAndSendMedia(chatId, standardizedData);
}

async function processWithApi1(extractedLink, chatId) {
    return processWithApi(extractedLink, chatId, 'API_1_Vapis', TIKTOK_API_1_ENDPOINT, API_1_TIMEOUT, extractDataFromApi1);
}

async function processWithApi2(extractedLink, chatId) {
    // Note: API 2 endpoint in original code already includes ?url=, so apiUrlBase for processWithApi needs to be just the base.
    // For simplicity, I'll adjust it here, or the processWithApi needs to be flexible or API_2_ENDPOINT changed.
    // Let's assume API_2_ENDPOINT is just the base for consistency with API_1_ENDPOINT structure for processWithApi.
    // const API_2_BASE_FOR_PROCESS_FN = 'https://api.vreden.my.id/api/tiktok?url='; // Original: TIKTOK_API_2_ENDPOINT
    // If TIKTOK_API_2_ENDPOINT is `https://api.vreden.my.id/api/tiktok`, then processWithApi should append `?url=`
    // Re-checking: TIKTOK_API_2_ENDPOINT = 'https://api.vreden.my.id/api/tiktok';
    // The generic processWithApi should probably handle adding `?url=` if the base doesn't have it.
    // For now, I'll assume processWithApi adds `?url=` if apiUrlBase does not end with it.
    // OR, better, ensure apiUrlBase in processWithApi is meant to have `?url=` appended.
    // Let's assume TIKTOK_API_X_ENDPOINT is the *base* and `?url=` is appended by processWithApi.
    // The provided code for processWithApi2 used: `${TIKTOK_API_2_ENDPOINT}?url=${encodeURIComponent(extractedLink)}`
    // So, TIKTOK_API_2_ENDPOINT is indeed the base.
    return processWithApi(extractedLink, chatId, 'API_2_Vreden', TIKTOK_API_2_ENDPOINT + "?url=", API_2_TIMEOUT, extractDataFromApi2);
    // ^ Adjusted apiUrlBase to include ?url= for this specific API call structure used in the original processWithApi2
}


// --- Fungsi untuk Deskripsi ---
function getStoredTikTokDescription(chatId, mediaId) {
    // Tidak perlu log di sini karena ini fungsi getter sederhana, kecuali untuk debug jika sering null
    logger.debug({ chatId, mediaId, context: 'getStoredTikTokDescription', found: !!tiktokDescriptions[chatId]?.[mediaId] }, 'Mengambil deskripsi tersimpan.');
    return tiktokDescriptions[chatId]?.[mediaId];
}

function clearStoredTikTokDescription(chatId, mediaId) {
    const logContext = { chatId, mediaId, context: 'clearStoredTikTokDescription' };
    if (tiktokDescriptions[chatId]?.[mediaId]) {
        delete tiktokDescriptions[chatId][mediaId];
        // MODIFIKASI: console.log -> logger.info
        logger.info(logContext, 'Deskripsi tersimpan telah dihapus.');
        if (Object.keys(tiktokDescriptions[chatId]).length === 0) {
            delete tiktokDescriptions[chatId];
            logger.debug(logContext, 'Objek deskripsi chat dihapus karena kosong.');
        }
    } else {
        logger.warn(logContext, 'Mencoba menghapus deskripsi yang tidak ada atau sudah dihapus.');
    }
}

module.exports = {
    handleTikTokLink,
    getStoredTikTokDescription,
    clearStoredTikTokDescription
};
