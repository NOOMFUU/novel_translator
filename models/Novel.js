const mongoose = require('mongoose');

const NovelSchema = new mongoose.Schema({
  title: { type: String, required: true }, // ชื่อเรื่องไทย
  originalTitle: { type: String, default: "" }, // ชื่อเรื่องญี่ปุ่น (ใหม่)
  description: String,
  
  // [ข้อมูลใหม่ตามรูป]
  author: { type: String, default: "-" },
  artist: { type: String, default: "-" },
  status: { type: String, enum: ['On Going', 'Completed', 'Hiatus'], default: 'On Going' },
  originalLink: { type: String, default: "" }, // ลิงก์ Web Novel ต้นฉบับ
  imageUrl: { type: String, default: "" },     // ลิงก์รูปปก
  tags: { type: [String], default: [] },       // ป้ายกำกับ เช่น Comedy, Romance
  views: { type: Number, default: 0 },         // ยอดวิว
  
  customPrompt: { type: String, default: "แปลให้อ่านง่าย เหมาะกับนิยายแฟนตาซี/Light Novel" },
  glossary: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Novel', NovelSchema);