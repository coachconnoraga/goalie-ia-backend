const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let systemPrompt = "";
try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'conocimiento.txt'), 'utf8');
} catch (err) {
  console.error("Advertencia: No se encontró el archivo conocimiento.txt.");
}

// ==========================================
// SISTEMA ANTI-TRAMPAS (HUELLAS Y IP TRACKING)
// ==========================================
const FREE_LIMIT = 7;
const ipUsage = new Map();
const deviceUsage = new Map();

// ==========================================
// 1. RUTA PRINCIPAL DE CHAT 
// ==========================================
app.post('/api/chat', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  // --- LOGICA DE BLOQUEO (ANTI-INCOGNITO / ANTI-TOR / MULTIPLES CORREOS) ---
  const deviceId = req.headers['x-device-id'] || 'unknown';
  const isPremiumClaim = req.headers['x-is-premium'] === 'true';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!isPremiumClaim) {
    const ipCount = ipUsage.get(ip) || 0;
    const deviceCount = deviceUsage.get(deviceId) || 0;

    // Si la IP o el Hardware pasaron los 7 mensajes, rechazar la conexión de inmediato
    if (ipCount >= FREE_LIMIT || (deviceId !== 'unknown' && deviceCount >= FREE_LIMIT)) {
      return res.status(403).json({ error: "FREE_TRIAL_EXCEEDED" });
    }

    // Sumar 1 mensaje al contador de este dispositivo e IP
    ipUsage.set(ip, ipCount + 1);
    if (deviceId !== 'unknown') {
      deviceUsage.set(deviceId, deviceCount + 1);
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
      res.status(500).json({ error: error.message || "Error procesando el chat o imagen." });
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
