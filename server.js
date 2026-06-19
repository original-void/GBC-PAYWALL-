const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const moment = require('moment');

const app = express();
app.use(express.json());

// Firebase from Render Env Var
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "ultimate-figure-499910-g0"
});
const db = admin.firestore();

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = '174379';

async function getToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });
  return res.data.access_token;
}

function formatPhone(phone) {
  phone = phone.replace(/\s+/g, '');
  if (phone.startsWith('0')) return '254' + phone.slice(1);
  if (phone.startsWith('+254')) return '254' + phone.slice(4);
  return phone;
}

// 1. STK Push KES 20
app.post('/initiate-payment', async (req, res) => {
  try {
    const phone = formatPhone(req.body.phone);
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');
    const token = await getToken();
    
    const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: 20,
      PartyA: phone,
      PartyB: SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: `https://gbc-paywall.onrender.com/callback`,
      AccountReference: 'GBCQuestions',
      TransactionDesc: 'Unlock questions KES 20'
    }, { headers: { Authorization: `Bearer ${token}` } });
    
    res.json({ success: true, CheckoutRequestID: response.data.CheckoutRequestID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// 3. Check payment status
app.get('/check-payment/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const doc = await db.collection('payments').doc(phone).get();
    
    if (!doc.exists) {
      return res.json({paid: false});
    }
    
    const data = doc.data();
    res.json({paid: data.paid, expiry: data.expiry});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Server error'});
  }
});
// 2. Callback
app.post('/callback', async (req, res) => {
  const callback = req.body.Body?.stkCallback;
  if (callback?.ResultCode === 0) {
    const phone = callback.CallbackMetadata.Item.find(i => i.Name === 'PhoneNumber').Value.toString();
    const expiry = moment().add(24, 'hours').toDate();
    await db.collection('payments').doc(phone).set({
      paid: true, amount: 20, expiry: expiry,
      paidAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// 3. Check payment
app.get('/check-payment/:phone', async (req, res) => {
  const phone = formatPhone(req.params.phone);
  const doc = await db.collection('payments').doc(phone).get();
  if (!doc.exists) return res.json({ paid: false });
  const data = doc.data();
  res.json({ paid: data.paid && data.expiry.toDate() > new Date() });
});

app.get('/', (req, res) => res.send('GBC Paywall running ✅'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Port ${PORT}`));
