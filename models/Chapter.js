const mongoose = require('mongoose');

const ChapterSchema = new mongoose.Schema({
  novelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel' },
  title: String,
  
  // [ใหม่] เก็บเลขตอนเป็นตัวเลข (รองรับทศนิยม เช่น 1.5) เพื่อการเรียงที่แม่นยำ
  chapterNumber: { type: Number, required: true, default: 0 }, 
  
  originalContent: String,
  translatedContent: String,
  createdAt: { type: Date, default: Date.now }
});

// สร้าง Index เพื่อให้ค้นหาเร็วขึ้น
ChapterSchema.index({ novelId: 1, chapterNumber: 1 });

module.exports = mongoose.model('Chapter', ChapterSchema);