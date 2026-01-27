const mongoose = require('mongoose');

const ChapterSchema = new mongoose.Schema({
  novelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel' },
  title: String,
  chapterNumber: { type: Number, required: true, default: 0 }, 
  originalContent: String,
  translatedContent: String,
  createdAt: { type: Date, default: Date.now }
});

ChapterSchema.index({ novelId: 1, chapterNumber: 1 });
module.exports = mongoose.model('Chapter', ChapterSchema);