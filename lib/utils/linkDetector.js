// lib/utils/linkDetector.js

//const FACEBOOK_REGEX = /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i;
//const TIKTOK_REGEX = /https?:\/\/(?:www\.|vm\.|vt\.|m\.|t\.)?(tiktok\.com)\/[^\s]+/i;

//const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?(instagram\.com)\/(?:p|reel|tv)\/[^\s\/]+/i;
//const TWITTER_REGEX = /https?:\/\/(?:www\.)?(twitter\.com|x\.com)\/\w+\/status\/[^\s\/]+/i;
//const DOUYIN_REGEX = /https?:\/\/(?:www\.|v\.|ies)?(douyin\.com)\/[^\s]+/i;

const FACEBOOK_REGEX = /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch)\/[^\s]*/i;
const TIKTOK_REGEX = /https?:\/\/(?:www\.|vm\.|vt\.|m\.|t\.)?tiktok\.com\/[^\s]*/i;
const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/[^\s]*/i;
const TWITTER_REGEX = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s]*/i;
const DOUYIN_REGEX = /https?:\/\/(?:www\.|v\.|ies\.)?douyin\.com\/[^\s]*/i;



function detectLinkType(text) {
    if (!text) return null;

    let match;

    match = text.match(FACEBOOK_REGEX);
    if (match) return { type: 'facebook', url: match[0] };

    match = text.match(TIKTOK_REGEX);
    if (match) return { type: 'tiktok', url: match[0] };

    match = text.match(INSTAGRAM_REGEX);
    if (match) return { type: 'instagram', url: match[0] };

    match = text.match(TWITTER_REGEX);
    if (match) return { type: 'twitter', url: match[0] };

    match = text.match(DOUYIN_REGEX);
    if (match) return { type: 'douyin', url: match[0] };

    return null;
}

module.exports = {
    detectLinkType
};
