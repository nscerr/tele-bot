// lib/services/uploader.js
const axios = require('axios');
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
 * Upload satu file dari URL sumber ke uguu.se.
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
        logger.info(logContext, `Mengunduh media untuk diunggah sebagai ${filename}`);
        const response = await axios({
            method: 'get',
            url: mediaUrl,
            responseType: 'stream',
            timeout: DOWNLOAD_TIMEOUT,
        });

        const form = new FormData();
        form.append('files[]', response.data, filename);

        logger.info(logContext, `Mengunggah ${filename} ke uguu.se...`);
        const uploadResponse = await axios.post(UGUU_UPLOAD_ENDPOINT, form, {
            headers: { ...form.getHeaders() },
            timeout: UGUU_UPLOAD_TIMEOUT,
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
 * Upload semua media URL dari hasil extract TFX ke uguu.se.
 * Mengembalikan object dengan URL uguu (atau URL asli jika upload gagal).
 *
 * @param {object} mediaData - Data dari downloader.extractMedia().data
 * @param {string} platform - Nama platform untuk penamaan file
 * @returns {Promise<object>} Object dengan URL final (uguu atau original sebagai fallback)
 */
async function uploadMediaUrls(mediaData, platform) {
    const logContext = { platform, context: 'uploadMediaUrls' };
    logger.info(logContext, `Memulai upload media ke uguu.se untuk platform ${platform}.`);

    const prefix = `${platform}_${generateSimpleId()}`;
    const result = {
        linkHd: mediaData.linkHd,
        linkMp4: mediaData.linkMp4,
        linkMp3: mediaData.linkMp3,
        images: mediaData.images ? [...mediaData.images] : null,
    };

    // Upload video HD
    if (mediaData.linkHd) {
        const uguuUrl = await uploadToUguu(mediaData.linkHd, `${prefix}_hd.mp4`);
        if (uguuUrl) result.linkHd = uguuUrl;
        else logger.warn({ ...logContext, type: 'linkHd' }, 'Gagal upload video HD, menggunakan URL asli.');
    }

    // Upload video SD/MP4 (hanya jika berbeda dari HD)
    if (mediaData.linkMp4 && mediaData.linkMp4 !== mediaData.linkHd) {
        const uguuUrl = await uploadToUguu(mediaData.linkMp4, `${prefix}_sd.mp4`);
        if (uguuUrl) result.linkMp4 = uguuUrl;
        else logger.warn({ ...logContext, type: 'linkMp4' }, 'Gagal upload video SD, menggunakan URL asli.');
    } else if (mediaData.linkMp4 === mediaData.linkHd && result.linkHd !== mediaData.linkHd) {
        // Jika SD sama dengan HD dan HD berhasil diupload, pakai URL uguu yang sama
        result.linkMp4 = result.linkHd;
    }

    // Upload audio MP3
    if (mediaData.linkMp3) {
        const uguuUrl = await uploadToUguu(mediaData.linkMp3, `${prefix}_audio.mp3`);
        if (uguuUrl) result.linkMp3 = uguuUrl;
        else logger.warn({ ...logContext, type: 'linkMp3' }, 'Gagal upload audio, menggunakan URL asli.');
    }

    // Upload slide images
    if (mediaData.images && mediaData.images.length > 0) {
        const uploadedImages = [];
        for (let i = 0; i < mediaData.images.length; i++) {
            const imageUrl = mediaData.images[i];
            const uguuUrl = await uploadToUguu(imageUrl, `${prefix}_slide${i + 1}.jpg`);
            uploadedImages.push(uguuUrl || imageUrl); // Fallback ke URL asli
        }
        result.images = uploadedImages;
    }

    logger.info(logContext, 'Selesai upload semua media ke uguu.se.');
    return result;
}

module.exports = {
    uploadToUguu,
    uploadMediaUrls,
    generateSimpleId,
};
