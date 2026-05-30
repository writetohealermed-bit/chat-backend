const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const ACCOUNT_SID = 'ACf793bbd51b76280f79af0033d7181095';
const AUTH_TOKEN = 'eb40349eb0a6a95354a197744688e7ff';
const TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
const YOUR_WHATSAPP_NUMBER = 'whatsapp:+923034515151';

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// File upload
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadDir));

// sessions: { sessionId: { customerName, messages: [] } }
const sessions = {};
// name lookup: { customerName_lowercase: sessionId } for reply routing
const nameToSession = {};

// ─── Start or resume a session ─────────────────────────────────────────────
app.post('/api/session', (req, res) => {
  const { sessionId, customerName } = req.body;
  if (!sessions[sessionId]) {
    sessions[sessionId] = { customerName, messages: [] };
    nameToSession[customerName.toLowerCase()] = sessionId;
  }
  res.json({ success: true, messages: sessions[sessionId].messages });
});

// ─── Customer sends text ────────────────────────────────────────────────────
app.post('/api/message', async (req, res) => {
  const { sessionId, message, customerName } = req.body;
  if (!sessions[sessionId]) {
    sessions[sessionId] = { customerName, messages: [] };
    nameToSession[customerName.toLowerCase()] = sessionId;
  }

  sessions[sessionId].messages.push({ from: 'customer', text: message, time: new Date() });

  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: YOUR_WHATSAPP_NUMBER,
      body: `💬 *${customerName}* says:\n\n${message}\n\n_Reply: ${customerName}: your message_`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Customer sends file ────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const { sessionId, customerName } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ success: false });

  if (!sessions[sessionId]) {
    sessions[sessionId] = { customerName, messages: [] };
    nameToSession[customerName.toLowerCase()] = sessionId;
  }

  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
  const isImage = file.mimetype.startsWith('image/');

  sessions[sessionId].messages.push({ from: 'customer', text: `📎 ${file.originalname}`, fileUrl, isImage, time: new Date() });

  try {
    const msgOptions = {
      from: TWILIO_WHATSAPP_NUMBER,
      to: YOUR_WHATSAPP_NUMBER,
      body: `📎 *${customerName}* sent: ${file.originalname}\n\n_Reply: ${customerName}: your message_`
    };
    if (isImage) msgOptions.mediaUrl = [fileUrl];
    await client.messages.create(msgOptions);
    res.json({ success: true, fileUrl, fileName: file.originalname, isImage });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Your WhatsApp reply ────────────────────────────────────────────────────
// Format: "CustomerName: your reply"
// Example: "Saad: Hello, your order is ready!"
app.post('/webhook', (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || '';

  if (from === YOUR_WHATSAPP_NUMBER && incomingMsg.includes(':')) {
    const colonIndex = incomingMsg.indexOf(':');
    const namePart = incomingMsg.substring(0, colonIndex).trim().toLowerCase();
    const reply = incomingMsg.substring(colonIndex + 1).trim();

    const sessionId = nameToSession[namePart];
    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].messages.push({ from: 'owner', text: reply, time: new Date() });
      io.to(sessionId).emit('new_message', { from: 'owner', text: reply });
      console.log(`Reply sent to ${namePart}: ${reply}`);
    } else {
      console.log(`No session found for name: ${namePart}`);
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ─── Get history ────────────────────────────────────────────────────────────
app.get('/api/history/:sessionId', (req, res) => {
  res.json(sessions[req.params.sessionId] || { messages: [] });
});

io.on('connection', (socket) => {
  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
