require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const Novel = require('./models/Novel');
const Chapter = require('./models/Chapter');

const app = express();
const port = process.env.PORT || 3000;

// Connect Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('DB Error:', err));

// Setup Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", // หรือ gemini-2.0-flash-exp ตามที่คุณมี
    generationConfig: { responseMimeType: "application/json" }
});

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(methodOverride('_method'));

// Helper: Auto Retry Function
async function generateWithRetry(prompt, retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return JSON.parse(response.text());
        } catch (error) {
            if (error.message.includes('429') || error.message.includes('503') || error.message.includes('Quota')) {
                console.log(`⚠️ Hit Rate Limit. Waiting ${delay/1000}s...`);
                if (i === retries - 1) throw error; 
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

// ================= ROUTES =================

app.get('/', async (req, res) => {
  const novels = await Novel.find().sort({ createdAt: -1 });
  res.render('index', { novels });
});

app.post('/novels', async (req, res) => {
  await Novel.create(req.body);
  res.redirect('/');
});

// [เพิ่มใหม่] Route ลบนิยาย (ลบทั้งนิยายและตอนทั้งหมดในเรื่องนั้น)
app.delete('/novel/:id', async (req, res) => {
    try {
        const novelId = req.params.id;
        await Novel.findByIdAndDelete(novelId);
        await Chapter.deleteMany({ novelId: novelId }); // ลบตอนทั้งหมดของเรื่องนี้
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.get('/novel/:id', async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  const chapters = await Chapter.find({ novelId: req.params.id }).sort({ chapterNumber: -1 }); // เรียงตอนล่าสุดขึ้นก่อน
  res.render('novel_detail', { novel, chapters });
});

app.get('/novel/:id/edit', async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  res.render('edit_novel', { novel });
});

app.put('/novel/:id', async (req, res) => {
  await Novel.findByIdAndUpdate(req.params.id, {
    title: req.body.title,
    description: req.body.description,
    customPrompt: req.body.customPrompt,
    glossary: req.body.glossary
  });
  res.redirect(`/novel/${req.params.id}`);
});

app.post('/api/translate-snippet', async (req, res) => {
    try {
        const { text } = req.body;
        const prompt = `Translate this Japanese novel title/short text to Thai naturally: "${text}". Return ONLY JSON: {"translatedText": "..."}`;
        const data = await generateWithRetry(prompt);
        res.json({ translatedText: data.translatedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/novel/:id/chapters', async (req, res) => {
  const novelId = req.params.id;
  const { mode, manualTitle, manualChapterNumber, manualTranslated, manualOriginal, rawText } = req.body;

  try {
    const lastChapter = await Chapter.findOne({ novelId }).sort({ chapterNumber: -1 });
    const nextNumber = lastChapter ? lastChapter.chapterNumber + 1 : 1;

    if (mode === 'manual') {
        await Chapter.create({
            novelId,
            chapterNumber: manualChapterNumber || nextNumber,
            title: manualTitle || `ตอนที่ ${manualChapterNumber || nextNumber}`,
            originalContent: manualOriginal || '',
            translatedContent: manualTranslated
        });
        return res.redirect(`/novel/${novelId}`);
    }

    // Auto Mode
    const novel = await Novel.findById(novelId);
    const systemInstruction = novel.customPrompt || "Translate into natural Thai suitable for Light Novels.";
    const glossaryText = novel.glossary ? `[STRICT GLOSSARY]:\n${novel.glossary}` : "";

    const prompt = `
      Analyze the following Japanese Web Novel text.
      [STYLE]: ${systemInstruction}
      ${glossaryText}
      
      Task:
      1. Extract chapter number (float/int). If not found, return null.
      2. Extract title line ONLY if explicit. Else null.
      3. Translate content.
      4. Return JSON:
      {
        "chapterNumber": 1,
        "title": "Thai Title (or null)",
        "translatedContent": "Content...",
        "originalTitle": "JP Title"
      }
      Japanese Text:
      ${rawText}
    `;

    const data = await generateWithRetry(prompt);

    const finalChapterNumber = (data.chapterNumber !== null && data.chapterNumber !== undefined) 
                                ? data.chapterNumber 
                                : nextNumber;
    
    let aiTitle = data.title || data.originalTitle || "";
    aiTitle = aiTitle.trim();
    const cleanedTitle = aiTitle.replace(/^(ตอนที่|บทที่|Chapter|Episode|Ep|第)?\s*[\d\.]+\s*[話]?\s*[:：]?\s*/ig, "");

    let finalTitle = (cleanedTitle === "") 
        ? `ตอนที่ ${finalChapterNumber}` 
        : `ตอนที่ ${finalChapterNumber} : ${cleanedTitle}`;

    await Chapter.create({
      novelId,
      chapterNumber: finalChapterNumber,
      title: finalTitle, 
      originalContent: rawText,
      translatedContent: data.translatedContent
    });

    res.redirect(`/novel/${novelId}`);

  } catch (error) {
    console.error(error);
    let errorMsg = error.message;
    if (error.message.includes('429')) errorMsg = "โควตาเต็มชั่วคราว (Too Many Requests)";
    res.send(`<h3>Error: ${errorMsg}</h3><a href="/novel/${novelId}">กลับ</a>`);
  }
});

app.get('/chapter/:id', async (req, res) => {
  const chapter = await Chapter.findById(req.params.id).populate('novelId');
  const allChapters = await Chapter.find({ novelId: chapter.novelId._id }).select('title chapterNumber _id').sort({ chapterNumber: 1 });
  const prevChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $lt: chapter.chapterNumber } }).sort({ chapterNumber: -1 });
  const nextChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $gt: chapter.chapterNumber } }).sort({ chapterNumber: 1 });
  res.render('read', { chapter, allChapters, prevChapter, nextChapter });
});

app.delete('/chapter/:id', async (req, res) => {
  const chapter = await Chapter.findByIdAndDelete(req.params.id);
  res.redirect(`/novel/${chapter.novelId}`);
});

app.get('/chapter/:id/edit', async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  res.render('edit', { chapter });
});

app.put('/chapter/:id', async (req, res) => {
  await Chapter.findByIdAndUpdate(req.params.id, {
    chapterNumber: req.body.chapterNumber,
    title: req.body.title,
    translatedContent: req.body.translatedContent
  });
  res.redirect(`/chapter/${req.params.id}`);
});

app.listen(port, () => console.log(`Server running on port ${port}`));