require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Models
const User = require('./models/User');
const Novel = require('./models/Novel');
const Chapter = require('./models/Chapter');


const app = express();
const port = process.env.PORT || 3000;

// Connect DB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('DB Error:', err));

// Middleware Setup
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

// Global Variables Middleware
app.use(async (req, res, next) => {
    // ส่งข้อมูล User ไปทุก Views
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.user?.role === 'admin';
    res.locals.isWriter = ['admin', 'writer'].includes(req.session.user?.role);
    res.locals.currentUrl = req.path;
    res.locals.defaultCover = 'https://placehold.co/400x600/png?text=No+Cover'; 
    res.locals.categories = await Novel.distinct('categories'); 
    next();
});

// Auth Middlewares
const requireLogin = (req, res, next) => {
    if (req.session.user) next();
    else res.redirect('/login');
};

const requireWriter = (req, res, next) => {
    if (res.locals.isWriter) next();
    else res.redirect('/');
};

const requireAdmin = (req, res, next) => {
    if (res.locals.isAdmin) next();
    else res.redirect('/');
};

// --- Auth Routes ---
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // แก้ไขตรงนี้: ใช้ Regex ค้นหาชื่อ โดยใส่ ^ และ $ เพื่อให้ตรงทั้งคำ และ 'i' คือไม่สนตัวเล็กใหญ่
        const user = await User.findOne({ 
            username: { $regex: new RegExp("^" + username + "$", "i") } 
        });

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = {
                _id: user._id,
                username: user.username, // ใช้ชื่อจริงจากในฐานข้อมูลเก็บเข้า Session
                role: user.role
            };
            res.redirect('/');
        } else {
            res.render('login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) { 
        console.error(err);
        res.redirect('/login'); 
    }
});

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;
    if(password !== confirmPassword) {
        return res.render('register', { error: 'รหัสผ่านไม่ตรงกัน' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        // User ใหม่จะเป็น reader โดย default
        await User.create({ username, password: hashedPassword, role: 'reader' });
        res.redirect('/login');
    } catch (err) {
        res.render('register', { error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
    }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// --- Main Routes ---
app.get('/', async (req, res) => {
    const query = req.query.q;
    const category = req.query.category;
    
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    let filter = {};
    if (query) filter.title = { $regex: query, $options: 'i' };
    if (category) filter.categories = category;

    try {
        const totalNovels = await Novel.countDocuments(filter);
        const totalPages = Math.ceil(totalNovels / limit);
        
        // [จุดสำคัญ] เปลี่ยน sort เป็น updatedAt: -1 (ล่าสุดขึ้นก่อน)
        const novels = await Novel.find(filter)
            .sort({ updatedAt: -1 }) 
            .skip(skip)
            .limit(limit);

        // ... (ส่วน Top Novels และ Recommended เหมือนเดิม)
        const topNovels = await Novel.find().sort({ views: -1 }).limit(5);
        let recommended = null;
        if (!query && !category && page === 1) {
             const count = await Novel.countDocuments({ imageUrl: { $ne: "" } });
             if(count > 0) {
                 const random = Math.floor(Math.random() * count);
                 recommended = await Novel.findOne({ imageUrl: { $ne: "" } }).skip(random);
             }
        }

        res.render('index', { 
            novels, query, currentCategory: category, recommended, topNovels, currentPage: page, totalPages: totalPages 
        });
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.get('/favorites', requireLogin, async (req, res) => {
    try {
        // ดึงข้อมูล User พร้อม Populate นิยาย โดยเรียงตาม updatedAt ล่าสุดมาก่อน
        const user = await User.findById(req.session.user._id).populate({
            path: 'favorites',
            options: { sort: { updatedAt: -1 } } // เรียงลำดับ: ล่าสุดขึ้นก่อน
        });
        
        res.render('favorites', { novels: user.favorites });
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});


app.get('/novel/:id', async (req, res) => {
    try {
        const novelId = req.params.id;
        
        // --- 1. รับค่า Search และ Pagination ---
        const chapterSearch = req.query.qChapter || ''; // คำค้นหาตอน
        const page = parseInt(req.query.page) || 1; 
        const limit = 50; 
        const skip = (page - 1) * limit;
        
        // --- 2. รับค่า Sort (เรียงลำดับ) ---
        const sortParam = req.query.sort || 'newest';
        const sortOrder = sortParam === 'oldest' ? 1 : -1; 

        let novel;

        // (Logic นับ View คงเดิม)
        if (!req.session.viewedNovels) req.session.viewedNovels = [];
        if (!req.session.viewedNovels.includes(novelId)) {
            novel = await Novel.findByIdAndUpdate(novelId, { $inc: { views: 1 } }, { new: true });
            req.session.viewedNovels.push(novelId);
        } else {
            novel = await Novel.findById(novelId);
        }

        // --- 3. สร้าง Filter สำหรับค้นหาตอน ---
        let chapterFilter = { novelId: novelId };
        
        if (chapterSearch) {
            const isNum = !isNaN(chapterSearch);
            if (isNum) {
                // ค้นหาทั้งเลขตอน และ ชื่อตอน
                chapterFilter.$or = [
                    { title: { $regex: chapterSearch, $options: 'i' } },
                    { chapterNumber: parseInt(chapterSearch) }
                ];
            } else {
                // ค้นหาเฉพาะชื่อตอน
                chapterFilter.title = { $regex: chapterSearch, $options: 'i' };
            }
        }

        // --- 4. ดึงข้อมูล (แยกจำนวนจริง vs จำนวนที่ Filter) ---
        
        // A. จำนวนตอนทั้งหมดจริงๆ (ไว้โชว์ตรง Info)
        const totalChaptersReal = await Chapter.countDocuments({ novelId: novelId });
        
        // B. จำนวนตอนตาม Filter (ไว้ทำ Pagination)
        const totalFilteredChapters = await Chapter.countDocuments(chapterFilter);
        const totalPages = Math.ceil(totalFilteredChapters / limit);

        // C. ดึงข้อมูลตอนตามหน้า
        const chapters = await Chapter.find(chapterFilter)
            .sort({ chapterNumber: sortOrder }) 
            .skip(skip)
            .limit(limit);
        
        // เช็ค Favorite
        let isFav = false;
        if(req.session.user) {
            const user = await User.findById(req.session.user._id);
            if(user.favorites.includes(novel._id)) isFav = true;
        }

        res.render('novel_detail', { 
            novel, 
            chapters, 
            isFav,
            currentPage: page,
            totalPages: totalPages,
            sortOrder: sortParam,
            totalChapters: totalChaptersReal, // ส่งจำนวนทั้งหมดจริงๆ ไป
            chapterSearch, // ส่งคำค้นหากลับไป
            totalFilteredChapters // ส่งจำนวนที่ค้นเจอไปเผื่อใช้แสดงผล
        });

    } catch (err) { console.error(err); res.redirect('/'); }
});

app.post('/novel/:id/favorite', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        const novelId = req.params.id;
        const index = user.favorites.indexOf(novelId);
        
        if (index === -1) {
            user.favorites.push(novelId); // Add
        } else {
            user.favorites.splice(index, 1); // Remove
        }
        await user.save();
        
        if(req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: true, isFav: index === -1 });
        }
        res.redirect(`/novel/${novelId}`);
    } catch(err) { res.status(500).send('Error'); }
});

// Writer/Admin Routes
app.post('/novels', requireWriter, async (req, res) => {
    try {
        const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [];
        // ถ้าไม่มีหมวดหมู่ ให้ใส่ General เสมอ
        const categoriesArray = req.body.categories ? req.body.categories.split(',').map(c => c.trim()).filter(c => c) : ['General'];
        
        // สร้างข้อมูล
        await Novel.create({
            title: req.body.title, // รับเฉพาะ title
            description: req.body.description || "", // รับคำอธิบาย (ถ้ามี)
            categories: categoriesArray,
            tags: tagsArray,
            author: req.session.user.username // (Optional) บันทึกชื่อคนสร้าง
        });

        res.redirect('/');
    } catch (err) {
        console.error("Create Novel Error:", err);
        // ส่ง error กลับไปให้ User เห็น หรือ redirect กลับหน้าเดิม
        res.status(500).send("เกิดข้อผิดพลาดในการสร้างนิยาย: " + err.message);
    }
});

app.get('/novel/:id/add', requireWriter, async (req, res) => {
    const novel = await Novel.findById(req.params.id);
    const lastChapter = await Chapter.findOne({ novelId: req.params.id }).sort({ chapterNumber: -1 });
    const nextChapterNumber = lastChapter ? lastChapter.chapterNumber + 1 : 1;
    res.render('add_chapter', { novel, nextChapterNumber });
});

app.post('/novel/:id/chapters', requireWriter, upload.single('txtFile'), async (req, res) => {
    try {
        const { manualTitle, manualChapterNumber, manualTranslated } = req.body;
        
        let content = manualTranslated;
        if (req.file) {
            content = req.file.buffer.toString('utf-8');
        }

        // สร้างตอนใหม่
        const newChapter = await Chapter.create({
            novelId: req.params.id,
            chapterNumber: manualChapterNumber,
            title: manualTitle || `ตอนที่ ${manualChapterNumber}`,
            translatedContent: content
        });

        // [จุดสำคัญ] อัปเดตข้อมูลนิยาย: เวลาล่าสุด และ ข้อมูลตอนล่าสุด
        await Novel.findByIdAndUpdate(req.params.id, {
            updatedAt: new Date(),
            lastChapter: {
                chapterNumber: newChapter.chapterNumber,
                title: newChapter.title,
                updatedAt: new Date()
            }
        });

        if (req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: true, chapter: newChapter });
        }
        res.redirect(`/novel/${req.params.id}`);
    } catch (error) {
        if (req.xhr) return res.status(500).json({ success: false, message: error.message });
        res.send(error.message);
    }
});

// Edit & Delete Routes (Writer/Admin)
app.get('/novel/:id/edit', requireWriter, async (req, res) => {
    const novel = await Novel.findById(req.params.id);
    res.render('edit_novel', { novel });
});
app.put('/novel/:id', requireWriter, async (req, res) => { /* Logic เหมือนเดิม */ 
    const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [];
    const categoriesArray = req.body.categories ? req.body.categories.split(',').map(c => c.trim()).filter(c => c) : ['General'];
    await Novel.findByIdAndUpdate(req.params.id, { ...req.body, tags: tagsArray, categories: categoriesArray });
    res.redirect(`/novel/${req.params.id}`);
});
app.delete('/novel/:id', requireAdmin, async (req, res) => {
    await Novel.findByIdAndDelete(req.params.id);
    await Chapter.deleteMany({ novelId: req.params.id });
    res.redirect('/');
});

// Chapter Routes
app.get('/chapter/:id', async (req, res) => {
    const chapter = await Chapter.findById(req.params.id).populate('novelId');
    const prevChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $lt: chapter.chapterNumber } }).sort({ chapterNumber: -1 });
    const nextChapter = await Chapter.findOne({ novelId: chapter.novelId._id, chapterNumber: { $gt: chapter.chapterNumber } }).sort({ chapterNumber: 1 });
    const allChapters = await Chapter.find({ novelId: chapter.novelId._id }).select('title chapterNumber _id').sort({ chapterNumber: 1 });
    res.render('read', { chapter, prevChapter, nextChapter, allChapters });
});

app.get('/chapter/:id/edit', requireWriter, async (req, res) => {
    const chapter = await Chapter.findById(req.params.id);
    res.render('edit', { chapter });
});
app.put('/chapter/:id', requireWriter, async (req, res) => {
    await Chapter.findByIdAndUpdate(req.params.id, req.body);
    if(req.xhr) res.json({ success: true });
    else res.redirect(`/chapter/${req.params.id}`);
});
app.delete('/chapter/:id', requireWriter, async (req, res) => {
    const chapter = await Chapter.findByIdAndDelete(req.params.id);
    res.redirect(`/novel/${chapter.novelId}`);
});

app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

app.listen(port, () => console.log(`Server running on port ${port}`));