require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // Store in memory to read text immediately

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
    model: "gemini-2.5-flash", 
    generationConfig: { responseMimeType: "application/json" }
});

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(methodOverride('_method'));

// Session
app.use(session({
    secret: 'secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware: ส่งค่า isAdmin ไปหน้า View
app.use((req, res, next) => {
    res.locals.isAdmin = req.session.isAdmin || false;
    next();
});

// Middleware: ตรวจสิทธิ์ Admin
const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Helper: Auto Retry
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

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. ค้นหา User ใน Database
        const user = await User.findOne({ username });

        // 2. ถ้าไม่เจอ User
        if (!user) {
            return res.render('login', { error: 'ชื่อผู้ใช้ไม่ถูกต้อง' });
        }

        // 3. ตรวจสอบรหัสผ่าน (เทียบรหัสที่กรอก กับ Hash ใน DB)
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            // ล็อกอินสำเร็จ
            req.session.isAdmin = true;
            req.session.username = user.username; // เก็บชื่อไว้หน่อยเผื่อใช้
            res.redirect('/');
        } else {
            // รหัสผิด
            res.render('login', { error: 'รหัสผ่านไม่ถูกต้อง' });
        }

    } catch (err) {
        console.error(err);
        res.render('login', { error: 'เกิดข้อผิดพลาดของระบบ' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- Public Routes ---

app.get('/', async (req, res) => {
  const query = req.query.q;
  let filter = {};
  
  if (query) {
    filter = { title: { $regex: query, $options: 'i' } }; // Case-insensitive search
  }

  const novels = await Novel.find(filter).sort({ createdAt: -1 });
  res.render('index', { novels, query }); // Pass 'query' back to view to keep input filled
});

app.get('/novel/:id', async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  const chapters = await Chapter.find({ novelId: req.params.id }).sort({ chapterNumber: -1 });
  res.render('novel_detail', { novel, chapters });
});

app.get('/chapter/:id', async (req, res) => {
  const chapter = await Chapter.findById(req.params.id).populate('novelId');
  const allChapters = await Chapter.find({ novelId: chapter.novelId._id }).select('title chapterNumber _id').sort({ chapterNumber: 1 });
  const prevChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $lt: chapter.chapterNumber } }).sort({ chapterNumber: -1 });
  const nextChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $gt: chapter.chapterNumber } }).sort({ chapterNumber: 1 });
  res.render('read', { chapter, allChapters, prevChapter, nextChapter });
});

// --- Admin Only Routes ---

app.post('/novels', requireAdmin, async (req, res) => {
  await Novel.create(req.body);
  res.redirect('/');
});

app.delete('/novel/:id', requireAdmin, async (req, res) => {
    try {
        const novelId = req.params.id;
        await Novel.findByIdAndDelete(novelId);
        await Chapter.deleteMany({ novelId: novelId });
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.get('/novel/:id/edit', requireAdmin, async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  res.render('edit_novel', { novel });
});

app.put('/novel/:id', requireAdmin, async (req, res) => {
  await Novel.findByIdAndUpdate(req.params.id, {
    title: req.body.title,
    description: req.body.description,
    customPrompt: req.body.customPrompt,
    glossary: req.body.glossary
  });
  res.redirect(`/novel/${req.params.id}`);
});

app.post('/api/translate-snippet', requireAdmin, async (req, res) => {
    try {
        const { text } = req.body;
        const prompt = `Translate this Japanese novel title/short text to Thai naturally: "${text}". Return ONLY JSON: {"translatedText": "..."}`;
        const data = await generateWithRetry(prompt);
        res.json({ translatedText: data.translatedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/novel/:id/chapters', requireAdmin, upload.single('txtFile'), async (req, res) => {
  const novelId = req.params.id;
  // 1. Determine Input Source (File vs Text Area)
  let rawText = req.body.rawText;

  if (req.file) {
      // If file uploaded, convert buffer to string (assuming UTF-8)
      rawText = req.file.buffer.toString('utf-8');
  }

  if (!rawText && req.body.mode === 'auto') {
      return res.send(`<h3>Error: No content provided (Text or File required)</h3><a href="/novel/${novelId}">Back</a>`);
  }

  const { mode, manualTitle, manualChapterNumber, manualTranslated, manualOriginal } = req.body;

  try {
    const lastChapter = await Chapter.findOne({ novelId }).sort({ chapterNumber: -1 });
    const nextNumber = lastChapter ? lastChapter.chapterNumber + 1 : 1;

    if (mode === 'manual') {
        // ... (Keep your existing manual logic here) ...
         await Chapter.create({
            novelId,
            chapterNumber: manualChapterNumber || nextNumber,
            title: manualTitle || `ตอนที่ ${manualChapterNumber || nextNumber}`,
            originalContent: manualOriginal || '',
            translatedContent: manualTranslated
        });
        return res.redirect(`/novel/${novelId}`);
    }

    // Auto Mode (Enhanced)
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
      Japanese Text (Limit 15000 chars):
      ${rawText.substring(0, 30000)} 
    `; // Added simple truncation to prevent token overflow if file is huge

    const data = await generateWithRetry(prompt);

    // ... (Keep your existing logic for saving data) ...
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
    res.send(`<h3>Error: ${error.message}</h3><a href="/novel/${novelId}">Back</a>`);
  }
});

app.delete('/chapter/:id', requireAdmin, async (req, res) => {
  const chapter = await Chapter.findByIdAndDelete(req.params.id);
  res.redirect(`/novel/${chapter.novelId}`);
});

app.get('/chapter/:id/edit', requireAdmin, async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  res.render('edit', { chapter });
});

app.put('/chapter/:id', requireAdmin, async (req, res) => {
  await Chapter.findByIdAndUpdate(req.params.id, {
    chapterNumber: req.body.chapterNumber,
    title: req.body.title,
    translatedContent: req.body.translatedContent
  });
  res.redirect(`/chapter/${req.params.id}`);
});

app.listen(port, () => console.log(`Server running on port ${port}`));