// api/webhook.js
const logger = require('../lib/utils/logger'); 

export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            logger.info("Pesan masuk dari Telegram");
            
            res.status(200).send('OK');
        } catch (error) {
            logger.error(error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        res.status(200).send('Bot is running...');
    }
}
