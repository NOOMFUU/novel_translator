const mongoose = require('mongoose');

const NovelSchema = new mongoose.Schema({
  title: String,
  description: String,
  customPrompt: { type: String, default: "แปลให้อ่านง่าย เหมาะกับนิยายแฟนตาซี/Light Novel" },
  // [ใหม่] เก็บคำศัพท์เฉพาะ (Glossary)
  glossary: { type: String, default: "" }, 
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Novel', NovelSchema);