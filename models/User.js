const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Hash
  role: { type: String, enum: ['admin', 'writer', 'reader'], default: 'reader' }, // เพิ่มระดับผู้ใช้
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }], // เก็บรายการโปรด
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);