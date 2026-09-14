const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const app = express();

// AUMENTO DE LÍMITE: Esto es vital para que acepte las fotos y audios sin explotar.
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Leer el archivo de conocimiento maestro
let systemPrompt = "";
try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'conocimiento.txt'), 'utf8');
} catch (err) {
  console.error("Advertencia: No se encontró el archivo conocimiento.txt. Asegúrate de que esté en GitHub.");
}

// ==========================================
// 1. RUTA PRINCIPAL DE CHAT E IMÁGENES
// ==========================================
app.post('/api/chat', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado. Verifica tu SECRET_TOKEN." });
  }

  try {
    const userMessages = req.body.messages || [];
    
    const messages = [
      { role: "system", content: systemPrompt },
      ...userMessages
    ];

    // Llamada a OpenAI con max_tokens explícito (requerido a veces por GPT-4o Vision)
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
    // Ahora enviamos el error real al frontend para poder diagnosticarlo
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Error procesando el chat o imagen." });
    }
  }
});

// ==========================================
// 2. RUTA PARA EL MICRÓFONO (WHISPER AI)
// ==========================================
app.post('/api/transcribe', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado. Verifica tu SECRET_TOKEN." });
  }

  try {
    const audioBase64 = req.body.audio;
    if (!audioBase64) return res.status(400).json({ error: 'No se recibió audio' });

    // Limpieza a prueba de balas del código Base64
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
    console.error("Error en la transcripción de audio:", error);
    res.status(500).json({ error: error.message || "Error procesando el audio." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor del AGA Coach corriendo en el puerto ${PORT}`);
});
