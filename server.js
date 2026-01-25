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
const upload = multer({ storage: multer.memoryStorage() });

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
    model: "gemini-1.5-flash", 
    generationConfig: { responseMimeType: "application/json" }
});

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(methodOverride('_method'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.currentUrl = req.path;
    next();
});

const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) next();
    else res.redirect('/login');
};

// Helper: AI Generate
async function generateWithRetry(prompt, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return JSON.parse(response.text());
        } catch (error) {
            console.error(`AI Error (Attempt ${i+1}):`, error);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Routes
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.isAdmin = true;
        res.redirect('/');
    } else {
        res.render('login', { error: 'รหัสผ่านไม่ถูกต้อง' });
    }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/', async (req, res) => {
    const query = req.query.q;
    const filter = query ? { title: { $regex: query, $options: 'i' } } : {};
    const novels = await Novel.find(filter).sort({ createdAt: -1 });
    res.render('index', { novels, query });
});

app.get('/novel/:id', async (req, res) => {
    try {
        const novel = await Novel.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        const chapters = await Chapter.find({ novelId: req.params.id }).sort({ chapterNumber: -1 });
        res.render('novel_detail', { novel, chapters });
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.post('/novels', requireAdmin, async (req, res) => {
    const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [];
    await Novel.create({ ...req.body, tags: tagsArray });
    res.redirect('/');
});

app.get('/novel/:id/edit', requireAdmin, async (req, res) => {
    const novel = await Novel.findById(req.params.id);
    res.render('edit_novel', { novel });
});

app.put('/novel/:id', requireAdmin, async (req, res) => {
    const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [];
    await Novel.findByIdAndUpdate(req.params.id, { ...req.body, tags: tagsArray });
    res.redirect(`/novel/${req.params.id}`);
});

app.delete('/novel/:id', requireAdmin, async (req, res) => {
    await Novel.findByIdAndDelete(req.params.id);
    await Chapter.deleteMany({ novelId: req.params.id });
    res.redirect('/');
});

// [Updated] Chapter Translation with JSON Support for AJAX
app.post('/novel/:id/chapters', requireAdmin, upload.single('txtFile'), async (req, res) => {
    const novelId = req.params.id;
    let rawText = req.body.rawText;
    if (req.file) rawText = req.file.buffer.toString('utf-8');

    const isAjax = req.headers.accept && req.headers.accept.includes('application/json');

    try {
        const { mode, manualTitle, manualChapterNumber, manualTranslated } = req.body;
        const lastChapter = await Chapter.findOne({ novelId }).sort({ chapterNumber: -1 });
        const nextNumber = lastChapter ? lastChapter.chapterNumber + 1 : 1;

        if (mode === 'manual') {
            await Chapter.create({
                novelId,
                chapterNumber: manualChapterNumber || nextNumber,
                title: manualTitle || `ตอนที่ ${manualChapterNumber || nextNumber}`,
                translatedContent: manualTranslated
            });
            if (isAjax) return res.json({ success: true, message: 'บันทึกสำเร็จ' });
            return res.redirect(`/novel/${novelId}`);
        }

        if (!rawText) throw new Error("No content to translate");

        const novel = await Novel.findById(novelId);
        const prompt = `
          Analyze Japanese Web Novel.
          Style: ${novel.customPrompt}
          Glossary: ${novel.glossary || "None"}
          Task: Translate to Thai. Return JSON: { "chapterNumber": float, "title": "Thai Title", "translatedContent": "..." }
          Text: ${rawText.substring(0, 30000)}
        `;

        const data = await generateWithRetry(prompt);
        const finalNumber = data.chapterNumber || nextNumber;
        const finalTitle = data.title ? `ตอนที่ ${finalNumber} : ${data.title}` : `ตอนที่ ${finalNumber}`;

        await Chapter.create({
          novelId,
          chapterNumber: finalNumber,
          title: finalTitle, 
          translatedContent: data.translatedContent
        });
    
        if (isAjax) return res.json({ success: true, message: 'แปลและบันทึกสำเร็จ' });
        res.redirect(`/novel/${novelId}`);

    } catch (error) {
        console.error(error);
        if (isAjax) return res.status(500).json({ success: false, message: error.message });
        res.send(`Error: ${error.message}`);
    }
});

app.get('/chapter/:id', async (req, res) => {
    const chapter = await Chapter.findById(req.params.id).populate('novelId');
    const prevChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $lt: chapter.chapterNumber } }).sort({ chapterNumber: -1 });
    const nextChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $gt: chapter.chapterNumber } }).sort({ chapterNumber: 1 });
    res.render('read', { chapter, prevChapter, nextChapter });
});

app.get('/chapter/:id/edit', requireAdmin, async (req, res) => {
    const chapter = await Chapter.findById(req.params.id);
    res.render('edit', { chapter });
});

app.put('/chapter/:id', requireAdmin, async (req, res) => {
    await Chapter.findByIdAndUpdate(req.params.id, req.body);
    // Return JSON for the Live Edit page if handled via fetch, else redirect
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        res.json({ success: true });
    } else {
        res.redirect(`/chapter/${req.params.id}`);
    }
});

app.delete('/chapter/:id', requireAdmin, async (req, res) => {
    const chapter = await Chapter.findByIdAndDelete(req.params.id);
    res.redirect(`/novel/${chapter.novelId}`);
});

app.listen(port, () => console.log(`Server running on port ${port}`));