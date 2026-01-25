const mongoose = require('mongoose');

const NovelSchema = new mongoose.Schema({
  title: { type: String, required: true },
  originalTitle: { type: String, default: "" },
  description: String,
  
  author: { type: String, default: "-" },
  artist: { type: String, default: "-" },
  
  // [แก้ไข] เปลี่ยนเป็น Array เพื่อเก็บได้หลายหมวด
  categories: { type: [String], default: ["General"] }, 
  
  status: { type: String, enum: ['On Going', 'Completed', 'Hiatus'], default: 'On Going' },
  originalLink: { type: String, default: "" }, 
  imageUrl: { type: String, default: "" },     
  tags: { type: [String], default: [] },       
  views: { type: Number, default: 0 },         
  
  customPrompt: { type: String, default: "แปลให้อ่านง่าย เหมาะกับนิยายแฟนตาซี/Light Novel" },
  glossary: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Novel', NovelSchema);