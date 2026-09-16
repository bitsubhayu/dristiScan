/**
 * DrishtiScan — GPT-OSS Integration Service (Groq API Generic Client)
 * 
 * Reusable, prompt-agnostic HTTP client for structured JSON generation via Groq API.
 */

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_TIMEOUT_MS = parseInt(process.env.GROQ_TIMEOUT_MS || '25000', 10);

/**
 * Check if Groq API key is configured and available in environment.
 * @returns {boolean}
 */
const isAvailable = () => {
    return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
};

/**
 * Generic call to Groq API expecting JSON object response with 429 backoff retry.
 * 
 * @param {string} systemPrompt - The system instructions
 * @param {Object} userPayload - The user payload object to stringify
 * @param {number} retryCount - Internal retry counter for rate limits
 * @returns {Promise<Object>} { success: true, content: Object, latencyMs, usage } or failure object
 */
const callGroqJson = async (systemPrompt, userPayload, retryCount = 0) => {
    if (!isAvailable()) {
        return { success: false, skipped: true, reason: 'GROQ_API_KEY is not configured' };
    }
    try {
        const startTime = Date.now();
        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(userPayload) }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 4096
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: GROQ_TIMEOUT_MS
            }
        );
        const latencyMs = Date.now() - startTime;
        const rawContent = response.data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            return { success: false, reason: 'Empty response received from Groq API', latencyMs };
        }
        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        } catch (parseErr) {
            return { success: false, reason: `Malformed JSON response: ${parseErr.message}`, latencyMs };
        }
        return { success: true, content: parsed, latencyMs, usage: response.data.usage || {} };
    } catch (err) {
        if (err.response?.status === 429 && retryCount < 3) {
            let waitMs = 2000 * Math.pow(2, retryCount);
            const msg = err.response?.data?.error?.message || '';
            const match = msg.match(/try again in ([\d.]+)s/i);
            if (match) {
                waitMs = Math.max(waitMs, Math.ceil(parseFloat(match[1]) * 1000) + 500);
            }
            console.warn(`[GPT-OSS] Rate limited (429). Retrying in ${waitMs}ms (attempt ${retryCount + 1}/3)...`);
            await new Promise(r => setTimeout(r, waitMs));
            return callGroqJson(systemPrompt, userPayload, retryCount + 1);
        }
        const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
        return {
            success: false,
            error: err.message,
            statusCode: err.response?.status || 500,
            rateLimited: err.response?.status === 429,
            detail: errorDetail
        };
    }
};

module.exports = {
    isAvailable,
    callGroqJson,
    GROQ_MODEL
};
