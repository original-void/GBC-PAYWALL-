const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

app.use(express.json());

// 1. Firebase init - uses env var from Render
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Get M-Pesa access token
async function getToken() {
  const auth = Buffer.from(process.env.MPESA_CONSUMER_KEY + ':' + process.env.MPESA_CONSUMER_SECRET).toString('base64');
  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });
  return res.data.access_token;
}

// 3. STK PUSH - triggers M-Pesa popup for 19 KES
app.post('/stk-push', async (req, res) => {
  try {
    const { phone } = req.body; // Format: 254708374149
    const amount = 19;
    
    const token = await getToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp).toString('base64');
    
    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: 'https://gbc-paywall.onrender.com/stk-callback',
        AccountReference: 'CIVIL ENG QUIZ',
        TransactionDesc: '19 KES - CIVIL ENG AND BUILDING TECH REVISION QUIZ'
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('STK Push Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 4. CALLBACK - M-Pesa hits this after payment. Auto saves true
app.post('/stk-callback', async (req, res) => {
  try {
    console.log('Callback received:', JSON.stringify(req.body));
    const stkCallback = req.body.Body.stkCallback;
    
    if (stkCallback.ResultCode === 0) {
      const items = stkCallback.CallbackMetadata.Item;
      const phone = items.find(i => i.Name === 'PhoneNumber').Value.toString();
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber').Value;
      
      // BOOM: Auto save to Firestore
      await db.collection('payments').doc(phone).set({
        paid: true,
        paidAt: admin.firestore.Timestamp.now(),
        receipt: receipt
      });
      
      console.log(`✅ Auto-saved paid:true for ${phone}`);
    } else {
      console.log('Payment failed/cancelled:', stkCallback.ResultDesc);
    }
    
    // M-Pesa MUST get this response
    res.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (err) {
    console.error('Callback error:', err);
    res.json({ ResultCode: 1, ResultDesc: "Failed" });
  }
});

// 5. CHECK PAYMENT - your Flutter app uses this
app.get('/check-payment/:phone', async (req, res) => {
  try {
    const doc = await db.collection('payments').doc(req.params.phone).get();
    res.json({ paid: doc.exists && doc.data().paid === true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
