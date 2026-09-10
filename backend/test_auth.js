const axios = require('axios');

async function testAuth() {
    const API = 'http://localhost:5000/api';

    console.log('--- Testing Guest Auth ---');
    const guestRes = await axios.post(`${API}/auth/guest`);
    console.log('Guest:', guestRes.data);

    console.log('\n--- Testing Officer Signup ---');
    const testEmail = `officer_${Date.now()}@metrology.gov.in`;
    try {
        const signupRes = await axios.post(`${API}/auth/signup`, {
            name: 'Inspector Vijay Verma',
            email: testEmail,
            password: 'SecurePassword123'
        });
        console.log('Signup:', signupRes.data);

        console.log('\n--- Testing Officer Login ---');
        const loginRes = await axios.post(`${API}/auth/login`, {
            email: testEmail,
            password: 'SecurePassword123'
        });
        console.log('Login:', loginRes.data);

        const token = loginRes.data.token;

        console.log('\n--- Testing /api/auth/me ---');
        const meRes = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Me:', meRes.data);

        console.log('\n--- Testing /api/officer/dashboard ---');
        const dashRes = await axios.get(`${API}/officer/dashboard`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Dashboard summary:', dashRes.data.summary);

        console.log('\n--- Testing /api/officer/repository ---');
        const repoRes = await axios.get(`${API}/officer/repository`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Repository count:', repoRes.data.total);

        console.log('\n--- Testing Forgot Password OTP ---');
        const forgotRes = await axios.post(`${API}/auth/forgot-password`, { email: testEmail });
        console.log('Forgot Password response:', forgotRes.data);

        console.log('\n✅ ALL AUTH & OFFICER API TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('Test Failed:', err.response?.data || err.message);
    }
}

testAuth();
