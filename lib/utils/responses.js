// lib/utils/responses.js

// Kamus balasan bot — edit teks di sini untuk mengubah semua respons bot
module.exports = {
    // --- Command Responses ---
    CMD_START: 'Paste aja link Facebook, TikTok, ato X lu ke mari ntar gw sedotin 🗿',
    CMD_HELP: 'Gw cuma bisa nyedot dari Facebook, TikTok, ama X doang yak sekarang.\n\nCara pakenya gampang njir, lu tinggal copas link videonya trus kirim ke sini. Udah gitu doang, gausah ribet 🗿',
    CMD_AI_OWNER: 'masih dibikin bos. mau ngapain lu 🗿',
    CMD_AI_DENIED: 'lu bukan admin gausah sok keras 🗿',
    CMD_HEALTH_CHECKING: 'bentar, ngecek server dulu 🗿',
    CMD_HEALTH_ONLINE: (uptimeStr) => `<b>on</b>\n\nuptime: ${uptimeStr} 🗿`,
    CMD_HEALTH_OFFLINE: '<b>off</b>\n\nserver lagi mati. coba ntar lagi 🗿',

    // --- Link Processing ---
    PROCESSING: 'sabar lagi diproses 🗿',
    LINK_UNSUPPORTED: 'Link apaan nih njir, kagak support. Kan udah gw bilang FB, TT, ato X doang kocak 🗿',
    EXTRACT_FAILED: (errorMsg) => `error njir: ${errorMsg} 🗿`,
    NO_MEDIA_FOUND: 'kosong ngab. gada yg bisa di donlod 🗿',

    // --- Non-link Messages ---
    NON_LINK_ASK: 'linknya mana njir 🗿',
    NON_LINK_FED_UP: 'terserah lu dah 🗿',
    NON_LINK_DEFAULT: '🗿',

    // --- Media Sending ---
    NO_VALID_MEDIA: 'gada yg bs didonlod 🗿',
    VIDEO_FALLBACK: (caption) => `g bisa ngirim langsung.\n\n${caption}\n\npake tombol aja di bawah 🗿`,
    VIDEO_FAIL_NO_LINK: 'g bisa ngirim + gada link donlod 🗿',
    SLIDE_FALLBACK: 'g bisa ngirim slide. pake tombol aja:\n🗿',
    SLIDE_FAIL_NO_LINK: 'g bisa ngirim slide 🗿',
    SLIDE_INFO_LIMIT: (count) => `<i>(cuma tombol donlod buat ${count} gambar pertama doang yak)</i> 🗿`,
    SLIDE_COUNTER: (current, total) => `<i>(${current}/${total})</i> 🗿`,
    ALBUM_BUTTONS_HEADER: 'tombol donlod: 🗿',

    // --- Button Labels ---
    BTN_DOWNLOAD_HD: 'Donlod HD 🔥🗿',
    BTN_DOWNLOAD_SD: 'Donlod SD 🥔🗿',
    BTN_DOWNLOAD_AUDIO: 'Donlod MP3 🎧🗿',
    BTN_DOWNLOAD_BG_AUDIO: 'Soundnya Doang 🎶🗿',
    BTN_DOWNLOAD_IMAGE: (index) => `Gambar ${index} 🖼️🗿`,
    BTN_FULL_DESC: 'Salin Caption 📄🗿',

    // --- Caption Building ---
    CAPTION_DESC: (desc) => `<b>desc:</b> ${desc}`,
    CAPTION_NO_DESC: (platformLabel) => `${platformLabel} 🗿`,
    CAPTION_AUTHOR: (author) => `\n\n<b>dari:</b> ${author} 🗿`,

    // --- Callback Query ---
    CB_DESC_NOT_FOUND: 'udah muncul ato udah ilang 🗿',
    CB_DESC_FAILED: 'gagal ngirim desc 🗿',
    CB_UNKNOWN_ACTION: 'apasi gajelas lu 🗿',
};
