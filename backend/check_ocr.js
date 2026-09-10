const axios = require('axios');
axios.get('http://127.0.0.1:8000/health', { timeout: 3000 })
    .then(r => console.log('OCR Health Check Result:', r.data))
    .catch(e => console.log('OCR check note:', e.message));
