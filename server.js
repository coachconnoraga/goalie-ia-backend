import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log("Iniciando servidor de Adaptive Goaltending...");

// 1. Verificamos que la llave de OpenAI exista
if (!process.env.OPENAI_API_KEY) {
  console.error("⚠️ ALERTA: No se encontró la OPENAI_API_KEY en Render.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'llave_nula' });

// 2. Leemos tu archivo con seguro anti-accidentes
let SYSTEM_PROMPT = "Eres un coach de lacrosse."; 
try {
  SYSTEM_PROMPT = fs.readFileSync('./conocimiento.txt', 'utf-8');
  console.log("✅ Archivo conocimiento.txt leído correctamente. Cerebro cargado.");
} catch (error) {
  console.error("⚠️ ERROR: No se pudo leer el archivo 'conocimiento.txt'.");
}

app.post('/api/chat', async (req, res) => {
  const fs = require('fs');
const path = require('path');

// NUEVA RUTA PARA PROCESAR EL AUDIO
app.post('/api/transcribe', async (req, res) => {
  try {
    // 1. Verificamos el token igual que en el chat
    const authHeader = req.headers.authorization;
    if (authHeader !== process.env.SECRET_TOKEN) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const audioBase64 = req.body.audio;
    if (!audioBase64) return res.status(400).json({ error: 'No audio provided' });

    // 2. Extraer el código Base64 y convertirlo a un archivo temporal real
    const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    
    const filePath = path.join(__dirname, `temp_audio_${Date.now()}.webm`);
    fs.writeFileSync(filePath, buffer);

    // 3. Enviar el archivo temporal a Whisper de OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });

    // 4. Borrar el archivo temporal para no llenar el disco del servidor
    fs.unlinkSync(filePath);

    // 5. Devolver el texto al usuario
    res.json({ text: transcription.text });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Error processing audio" });
  }
});
