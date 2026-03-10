// lib/services/uploader.js
const axios = require('axios');
const { gotScraping } = require('got-scraping');
const FormData = require('form-data');
const path = require('path');
const logger = require('../utils/logger');

const UGUU_UPLOAD_ENDPOINT = 'https://uguu.se/upload';
const UGUU_UPLOAD_TIMEOUT = 90000;
const DOWNLOAD_TIMEOUT = 45000;
const MAX_FILE_SIZE_FOR_UGUU = 128 * 1024 * 1024; // 128MB

/**
 * Generate ID sederhana untuk nama file unik.
 */
function generateSimpleId() {
    return Math.random().toString(36).substring(2, 9);
}

/**
 * Ambil ekstensi file dari URL.
 */
function getFileExtensionFromUrl(url) {
    if (!url) return '.tmp';
    try {
        const pathname = new URL(url).pathname;
        const ext = path.extname(pathname);
        if (!ext && (url.includes('video') || url.includes('mp4'))) return '.mp4';
        if (!ext && (url.includes('photo') || url.includes('jpg') || url.includes('jpeg'))) return '.jpg';
        if (!ext && url.includes('mp3')) return '.mp3';
        return ext || '.tmp';
    } catch (e) {
        logger.warn({ url, err: e, context: 'getFileExtensionFromUrl' }, 'Error parsing URL untuk ekstensi.');
        return '.tmp';
    }
}

/**
 * Download media dari URL menggunakan got-scraping (TLS Chrome fingerprint).
 * @param {string} mediaUrl - URL media CDN
 * @returns {Promise<Buffer|null>} Buffer media atau null jika gagal
 */
async function downloadWithGotScraping(mediaUrl) {
    const logContext = { mediaUrl, context: 'downloadWithGotScraping' };
    try {
        logger.info(logContext, 'Mengunduh media dengan got-scraping (TLS Chrome)...');
        const response = await gotScraping({
            url: mediaUrl,
            responseType: 'buffer',
            timeout: { request: DOWNLOAD_TIMEOUT },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                operatingSystems: ['windows'],
            },
        });

        const buffer = response.body;
        const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
        logger.info({ ...logContext, sizeMb }, `Berhasil download: ${sizeMb}MB`);

        if (buffer.length > MAX_FILE_SIZE_FOR_UGUU) {
            logger.warn({ ...logContext, sizeMb }, `File terlalu besar untuk uguu.se (>${MAX_FILE_SIZE_FOR_UGUU / (1024 * 1024)}MB).`);
            return null;
        }

        return buffer;
    } catch (error) {
        logger.error({ ...logContext, err: error }, `Gagal download media dari ${mediaUrl}`);
        return null;
    }
}

/**
 * Upload satu file dari URL sumber ke uguu.se.
 * Menggunakan got-scraping untuk download (bypass CDN anti-bot).
 * @param {string} mediaUrl - URL media yang akan di-download lalu upload
 * @param {string} [desiredFilename] - Nama file yang diinginkan
 * @returns {Promise<string|null>} URL uguu.se atau null jika gagal
 */
async function uploadToUguu(mediaUrl, desiredFilename) {
    const logContext = { mediaUrl, desiredFilename, context: 'uploadToUguu' };

    if (!mediaUrl) {
        logger.error(logContext, 'mediaUrl tidak disediakan.');
        return null;
    }

    let filename = desiredFilename || `media_${generateSimpleId()}${getFileExtensionFromUrl(mediaUrl)}`;
    filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 100);
    logContext.finalFilename = filename;

    try {
        // Step 1: Download ke buffer dengan got-scraping (TLS Chrome fingerprint)
        const buffer = await downloadWithGotScraping(mediaUrl);
        if (!buffer) {
            logger.error(logContext, 'Download gagal, tidak bisa upload ke uguu.se.');
            return null;
        }

        // Step 2: Upload buffer ke uguu.se
        const form = new FormData();
        form.append('files[]', buffer, { filename });

        logger.info({ ...logContext, bufferSizeMb: (buffer.length / (1024 * 1024)).toFixed(2) }, `Mengunggah ${filename} ke uguu.se...`);
        const uploadResponse = await axios.post(UGUU_UPLOAD_ENDPOINT, form, {
            headers: { ...form.getHeaders() },
            timeout: UGUU_UPLOAD_TIMEOUT,
            maxContentLength: MAX_FILE_SIZE_FOR_UGUU,
            maxBodyLength: MAX_FILE_SIZE_FOR_UGUU,
        });

        if (uploadResponse.status === 200 && uploadResponse.data?.success === true && uploadResponse.data.files?.length > 0) {
            const uploadedFile = uploadResponse.data.files[0];
            logger.info({
                ...logContext,
                uploadedUrl: uploadedFile.url,
                size: uploadedFile.size,
            }, `Berhasil diunggah: ${uploadedFile.url}`);
            return uploadedFile.url;
        }

        logger.error({
            ...logContext,
            responseStatus: uploadResponse.status,
            responseData: uploadResponse.data,
        }, 'Gagal unggah atau respons uguu.se tidak sesuai.');
        return null;

    } catch (error) {
        logger.error({
            ...logContext,
            err: error,
            responseData: error.response?.data,
        }, `Error selama proses unggah uguu.se untuk ${mediaUrl}`);
        return null;
    }
}

/**
 * Upload semua media URL dari hasil extract TFX ke uguu.se secara PARALEL.
 * Menggunakan got-scraping untuk download (bypass CDN anti-bot).
 *
 * @param {object} mediaData - Data dari downloader.extractMedia().data
 * @param {string} platform - Nama platform untuk penamaan file
 * @returns {Promise<object>} Object dengan URL final (uguu atau original sebagai fallback)
 */
async function uploadMediaUrls(mediaData, platform) {
    const logContext = { platform, context: 'uploadMediaUrls' };
    logger.info(logContext, `Memulai upload PARALEL media ke uguu.se untuk platform ${platform}.`);

    const prefix = `${platform}_${generateSimpleId()}`;
    const result = {
        linkHd: mediaData.linkHd,
        linkMp4: mediaData.linkMp4,
        linkMp3: mediaData.linkMp3,
        images: mediaData.images ? [...mediaData.images] : null,
    };

    // --- Upload video, audio secara PARALEL ---
    const uploadTasks = [];

    // Task: Upload video HD
    if (mediaData.linkHd) {
        uploadTasks.push(
            uploadToUguu(mediaData.linkHd, `${prefix}_hd.mp4`).then(uguuUrl => {
                if (uguuUrl) result.linkHd = uguuUrl;
                else logger.warn({ ...logContext, type: 'linkHd' }, 'Gagal upload video HD, menggunakan URL asli.');
            })
        );
    }

    // Task: Upload video SD/MP4 (hanya jika berbeda dari HD)
    if (mediaData.linkMp4 && mediaData.linkMp4 !== mediaData.linkHd) {
        uploadTasks.push(
            uploadToUguu(mediaData.linkMp4, `${prefix}_sd.mp4`).then(uguuUrl => {
                if (uguuUrl) result.linkMp4 = uguuUrl;
                else logger.warn({ ...logContext, type: 'linkMp4' }, 'Gagal upload video SD, menggunakan URL asli.');
            })
        );
    }

    // Task: Upload audio MP3
    if (mediaData.linkMp3) {
        uploadTasks.push(
            uploadToUguu(mediaData.linkMp3, `${prefix}_audio.mp3`).then(uguuUrl => {
                if (uguuUrl) result.linkMp3 = uguuUrl;
                else logger.warn({ ...logContext, type: 'linkMp3' }, 'Gagal upload audio, menggunakan URL asli.');
            })
        );
    }

    // Task: Upload semua slide images secara PARALEL
    if (mediaData.images && mediaData.images.length > 0) {
        const imageUploadPromises = mediaData.images.map((imageUrl, i) =>
            uploadToUguu(imageUrl, `${prefix}_slide${i + 1}.jpg`).then(uguuUrl => ({
                index: i,
                url: uguuUrl || imageUrl, // Fallback ke URL asli
            }))
        );
        uploadTasks.push(
            Promise.all(imageUploadPromises).then(results => {
                // Pastikan urutan gambar tetap benar
                const uploadedImages = new Array(mediaData.images.length);
                for (const r of results) {
                    uploadedImages[r.index] = r.url;
                }
                result.images = uploadedImages;
            })
        );
    }

    // Jalankan semua upload secara paralel
    await Promise.all(uploadTasks);

    // Handle kasus SD === HD setelah upload selesai
    if (mediaData.linkMp4 && mediaData.linkMp4 === mediaData.linkHd && result.linkHd !== mediaData.linkHd) {
        result.linkMp4 = result.linkHd;
    }

    logger.info(logContext, 'Selesai upload paralel semua media ke uguu.se.');
    return result;
}

module.exports = {
    uploadToUguu,
    uploadMediaUrls,
    generateSimpleId,
};
