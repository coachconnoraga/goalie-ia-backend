const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cargar conocimiento
let systemPrompt = "";
try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'conocimiento.txt'), 'utf8');
} catch (err) {
  console.error("Advertencia: No se encontró el archivo conocimiento.txt.");
}

// ==========================================
// CONEXIÓN A MONGODB (BASE DE DATOS)
// ==========================================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ Conectado exitosamente a la Base de Datos MongoDB'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// Estructura de la Base de Datos para el límite de mensajes
const trackerSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true }, // Guarda la IP o la Huella del Dispositivo
  count: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now }
});
const Tracker = mongoose.model('Tracker', trackerSchema);

const FREE_LIMIT = 7;

// ==========================================
// 1. RUTA PRINCIPAL DE CHAT 
// ==========================================
app.post('/api/chat', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  // --- LÓGICA DE BLOQUEO INVULNERABLE EN MONGODB ---
  const deviceId = req.headers['x-device-id'] || 'unknown';
  const isPremiumClaim = req.headers['x-is-premium'] === 'true';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!isPremiumClaim) {
    try {
      // Buscar en la Base de Datos la computadora (deviceId) y la red WiFi (IP)
      let deviceRecord = await Tracker.findOne({ identifier: deviceId });
      let ipRecord = await Tracker.findOne({ identifier: ip });

      const deviceCount = deviceRecord ? deviceRecord.count : 0;
      const ipCount = ipRecord ? ipRecord.count : 0;

      // Si cualquiera de los dos ya gastó 7 mensajes, se rechaza inmediatamente
      if (ipCount >= FREE_LIMIT || (deviceId !== 'unknown' && deviceCount >= FREE_LIMIT)) {
        return res.status(403).json({ error: "FREE_TRIAL_EXCEEDED" });
      }

      // Si aún tienen saldo, sumar 1 mensaje y guardarlo en la Base de Datos
      if (deviceId !== 'unknown') {
        await Tracker.findOneAndUpdate(
          { identifier: deviceId },
          { $inc: { count: 1 }, lastUsed: Date.now() },
          { upsert: true, new: true }
        );
      }
      await Tracker.findOneAndUpdate(
        { identifier: ip },
        { $inc: { count: 1 }, lastUsed: Date.now() },
        { upsert: true, new: true }
      );

    } catch (dbError) {
      console.error("Error consultando Base de Datos:", dbError);
    }
  }
  // ------------------------------------------------------------------------

  try {
    const userMessages = req.body.messages || [];
    const messages = [
      { role: "system", content: systemPrompt },
      ...userMessages
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      stream: true,
      max_tokens: 2000, 
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Error en /api/chat:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Error procesando el chat." });
    }
  }
});

// ==========================================
// 2. RUTA PARA EL MICRÓFONO (WHISPER)
// ==========================================
app.post('/api/transcribe', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  try {
    const audioBase64 = req.body.audio;
    if (!audioBase64) return res.status(400).json({ error: 'No se recibió audio' });

    const base64Data = audioBase64.split(',')[1]; 
    const buffer = Buffer.from(base64Data, 'base64');
    
    const filePath = path.join(__dirname, `temp_audio_${Date.now()}.webm`);
    fs.writeFileSync(filePath, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });

    fs.unlinkSync(filePath);
    res.json({ text: transcription.text });

  } catch (error) {
    console.error("Error en la transcripción:", error);
    res.status(500).json({ error: error.message || "Error procesando el audio." });
  }
});

// ==========================================
// 3. RUTA TEXT TO SPEECH (TTS)
// ==========================================
app.post('/api/tts', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const cleanText = text.replace(/[*#_`>]/g, '');

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx", 
      input: cleanText,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
    
  } catch (error) {
    console.error("Error en TTS:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor del AGA Coach corriendo en el puerto ${PORT}`);
});
