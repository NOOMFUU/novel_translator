const mongoose = require('mongoose');

const NovelSchema = new mongoose.Schema({
  title: { type: String, required: true },
  originalTitle: { type: String, default: "" },
  description: String,
  author: { type: String, default: "-" },
  artist: { type: String, default: "-" },
  categories: { type: [String], default: ["General"] }, 
  status: { type: String, enum: ['On Going', 'Completed', 'Hiatus'], default: 'On Going' },
  originalLink: { type: String, default: "" }, 
  imageUrl: { type: String, default: "" },     
  tags: { type: [String], default: [] },       
  views: { type: Number, default: 0 },         
  // ลบ customPrompt และ glossary ออกแล้ว
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastChapter: {
    chapterNumber: Number,
    title: String,
    updatedAt: Date
  }
});

NovelSchema.pre('save', async function() {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('Novel', NovelSchema);